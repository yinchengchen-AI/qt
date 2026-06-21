import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { ContractCreateInput, ContractUpdateInput, ReviewActionInput } from "@/lib/validators/contract";
import { ownerEq, ownerViaContract, parseStatusList } from "@/lib/ownership";
import { getBillingStatus } from "@/lib/contract-billing";
import type { BillingStatus } from "@/types/enums";
import { Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { emit, listAdminUserIds } from "@/server/events/bus";

// 把前端传的 attachment 快照(id+name+...)用 DB 真实记录重写一遍,防 spoofing
// 同时在事务内把 presign 时落 tmp/ 的附件绑到新合同 contractId
async function resolveAttachmentSnapshots(
  raw: { id: string; name: string; url?: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string }[],
  contractId: string,
  tx: Prisma.TransactionClient
): Promise<Prisma.InputJsonValue> {
  if (raw.length === 0) return [] as unknown as Prisma.InputJsonValue;
  if (raw.length > 5) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "附件最多 5 个", 400);
  }
  // 老系统迁移数据: id 以 legacy- 开头, 仅作为历史元数据展示, 实际对象不在 Attachment 表
  // 直接原样保留, 不走 DB 校验 / 绑定流程
  const LEGACY_PREFIX = "legacy-";
  const legacyEntries = raw.filter((r) => r.id.startsWith(LEGACY_PREFIX));
  const realEntries = raw.filter((r) => !r.id.startsWith(LEGACY_PREFIX));

  const resolvedFromDb: Array<{ id: string; name: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string; url?: string }> = [];
  if (realEntries.length > 0) {
    const ids = [...new Set(realEntries.map((r) => r.id))];
    const found = await tx.attachment.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, originalName: true, mimeType: true, size: true, uploadedById: true, uploadedAt: true, contractId: true, invoiceId: true }
    });
    if (found.length !== ids.length) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "附件 id 无效或已删除", 400);
    }
    // 绑定到当前合同:
    //   - 没绑任何东西(presign 时 contractId/invoiceId 都为 null -> 落 tmp):绑定到本 contract
    //   - 已绑本 contract:放过
    //   - 已绑别的合同 / 发票:拒绝(防越权)
    const toBind = found.filter((a) => !a.contractId && !a.invoiceId);
    if (toBind.length > 0) {
      await tx.attachment.updateMany({
        where: { id: { in: toBind.map((a) => a.id) }, contractId: null, invoiceId: null },
        data: { contractId }
      });
    }
    // 已绑本 contract:放过;已绑其它 contract 或 任意 invoice:拒绝
    const others = found.filter((a) =>
      (a.contractId && a.contractId !== contractId) || a.invoiceId
    );
    if (others.length > 0) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "部分附件已绑定到其它合同/发票", 403);
    }
    resolvedFromDb.push(...found.map((a) => ({
      id: a.id,
      name: a.originalName,
      mimeType: a.mimeType,
      size: a.size,
      uploadedBy: a.uploadedById,
      uploadedAt: a.uploadedAt.toISOString()
    })));
  }

  // 保持原顺序: legacy 也按 raw 提交时的顺序保留 (在它被提交的位置)
  const byId = new Map<string, { id: string; name?: string; mimeType?: string; size?: number; uploadedBy?: string; uploadedAt?: string; url?: string }>();
  for (const e of legacyEntries) byId.set(e.id, e as { id: string; name?: string; mimeType?: string; size?: number; uploadedBy?: string; uploadedAt?: string; url?: string });
  for (const e of resolvedFromDb) byId.set(e.id, e);
  return raw.map((r) => byId.get(r.id) as { id: string; name?: string; mimeType?: string; size?: number; uploadedBy?: string; uploadedAt?: string; url?: string }) as unknown as Prisma.InputJsonValue;
}



function calcTotals(totalAmount: number, taxRate: number) {
  const taxAmount = round2((totalAmount * taxRate) / (1 + taxRate));
  const amountExcludingTax = round2(totalAmount - taxAmount);
  return { taxAmount, amountExcludingTax };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

export async function listContracts(
  user: SessionUser,
  params: { page: number; pageSize: number; keyword?: string; status?: string; customerId?: string }
) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);
  const { page, pageSize, keyword, status, customerId } = params;
  const statusList = parseStatusList(status);
  const where: Prisma.ContractWhereInput = {
    ...ownerEq(user),
    deletedAt: null,
    ...(statusList ? { status: { in: statusList } } : {}),
    ...(customerId ? { customerId } : {}),
    ...(keyword
      ? {
          OR: [
            { contractNo: { contains: keyword, mode: "insensitive" } },
            { title: { contains: keyword, mode: "insensitive" } },
            { customerName: { contains: keyword, mode: "insensitive" } }
          ]
        }
      : {})
  };
  const [list, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      orderBy: { signDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.contract.count({ where })
  ]);

  // 批量聚合每张合同的已开票(Invoice.status=ISSUED)与已回款(Payment.status IN CONFIRMED,RECONCILED)
  // 避免 N+1;与 server/services/statistics.ts:18-30 语义一致
  const ids = list.map((c) => c.id);
  const [invoiceAgg, paymentAgg] = ids.length
    ? await Promise.all([
        prisma.invoice.groupBy({
          by: ["contractId"],
          where: { contractId: { in: ids }, status: "ISSUED", deletedAt: null },
          _sum: { amount: true }
        }),
        prisma.payment.groupBy({
          by: ["contractId"],
          where: { contractId: { in: ids }, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null },
          _sum: { amount: true }
        })
      ])
    : [[], []];
  const invoicedByContract = new Map(invoiceAgg.map((r) => [r.contractId, Number(r._sum.amount ?? 0)]));
  const paidByContract = new Map(paymentAgg.map((r) => [r.contractId, Number(r._sum.amount ?? 0)]));

  const enriched = list.map((c) => {
    const invoicedAmount = invoicedByContract.get(c.id) ?? 0;
    const paidAmount = paidByContract.get(c.id) ?? 0;
    return {
      ...c,
      invoicedAmount,
      paidAmount,
      billingStatus: getBillingStatus(invoicedAmount, Number(c.totalAmount))
    };
  });
  return { list: enriched, total, page, pageSize };
}

export async function getContract(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);
  const c = await prisma.contract.findFirst({
    where: { id, deletedAt: null, ...ownerEq(user) },
    include: {
      reviewLogs: {
        orderBy: { at: "asc" },
        include: {
          // reviewer 名字取出来,前端不用再 useUserName 单查
          // 这里不直接 include user 表,避免越权拿到 user;由 service 内做白名单投影
        }
      }
    }
  });
  if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
  // 投影 reviewer 姓名(批量查避免 N+1),只返回 id + name
  const reviewerIds = Array.from(new Set(c.reviewLogs.map((l) => l.reviewerId).filter(Boolean)));
  const reviewers = reviewerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: reviewerIds } },
        select: { id: true, name: true }
      })
    : [];
  const nameById = new Map(reviewers.map((u) => [u.id, u.name]));
  return {
    ...c,
    reviewLogs: c.reviewLogs.map((l) => ({
      id: l.id,
      action: l.action,
      comment: l.comment,
      at: l.at,
      reviewerId: l.reviewerId,
      reviewerName: nameById.get(l.reviewerId) ?? ""
    }))
  };
}

export async function createContract(user: SessionUser, input: ContractCreateInput) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.CREATE);
  // Dictionary 兜底: 防止 zod 放行后写入任意 serviceType
  const st = await prisma.dictionary.findUnique({ where: { category_code: { category: "SERVICE_TYPE", code: input.serviceType } } });
  if (!st) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `serviceType ${input.serviceType} not in dictionary`, 400);
  // R-03
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, deletedAt: null } });
  if (!customer) throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
  if (!["NEGOTIATING", "SIGNED"].includes(customer.status)) {
    throw new ApiError(ERROR_CODES.CONTRACT_CUSTOMER_STATUS, "客户当前状态不允许新建合同", 422);
  }
  // 校验签订人:前端不传时回退为当前 user;若显式传入,确保目标用户存在且未停用
  const signerId = input.signerId ?? user.id;
  const signer = await prisma.user.findFirst({ where: { id: signerId, deletedAt: null } });
  if (!signer) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, "签订人不存在", 404);
  }
  if (signer.status !== "ACTIVE") {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "签订人必须是启用状态员工", 400);
  }
  if (new Date(input.endDate) < new Date(input.startDate)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "结束日期不能早于开始日期", 400);
  }
  // 合同编号唯一性预校验:DB 也有 @unique,但提前抛错返回更明确的 422 信息
  const existingNo = await prisma.contract.findFirst({ where: { contractNo: input.contractNo, deletedAt: null } });
  if (existingNo) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `合同编号 ${input.contractNo} 已被使用`, 422);
  }
  return prisma.$transaction(async (tx) => {
    const { taxAmount, amountExcludingTax } = calcTotals(input.totalAmount, input.taxRate);
    const created = await tx.contract.create({
      data: {
        contractNo: input.contractNo,
        customerId: input.customerId,
        customerName: customer.name,
        title: input.title,
        serviceType: input.serviceType,
        signDate: new Date(input.signDate),
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        totalAmount: input.totalAmount,
        taxRate: input.taxRate,
        taxAmount,
        amountExcludingTax,
        paymentMethod: input.paymentMethod,
        signerId,
        installmentPlan: (input.installmentPlan ?? null) as Prisma.InputJsonValue,
        status: "DRAFT",
        ownerUserId: customer.ownerUserId,
        attachments: [] as unknown as Prisma.InputJsonValue,
        createdById: user.id,
        updatedById: user.id
      }
    });
    // 解析附件并绑定(tmp -> contractId),把真实记录写回 JSON 快照
    if ((input.attachments ?? []).length > 0) {
      const attachments = await resolveAttachmentSnapshots(input.attachments ?? [], created.id, tx);
      await tx.contract.update({ where: { id: created.id }, data: { attachments } });
    }
    return tx.contract.findUnique({ where: { id: created.id } });
  });
}

export async function updateContract(user: SessionUser, id: string, input: ContractUpdateInput) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.UPDATE);
  const existing = await prisma.contract.findFirst({ where: { id, deletedAt: null, ...ownerEq(user) } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
  if (!["DRAFT", "PENDING_REVIEW", "SUSPENDED"].includes(existing.status)) {
    throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "当前状态不可修改", 403);
  }
  // 合同编号若变更需唯一性校验
  if (input.contractNo !== undefined && input.contractNo !== existing.contractNo) {
    const dup = await prisma.contract.findFirst({
      where: { contractNo: input.contractNo, deletedAt: null, NOT: { id } }
    });
    if (dup) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `合同编号 ${input.contractNo} 已被使用`, 422);
    }
  }
  // 重算总额
  let taxAmount = existing.taxAmount;
  let amountExcludingTax = existing.amountExcludingTax;
  if (input.totalAmount !== undefined || input.taxRate !== undefined) {
    const ta = input.totalAmount ?? Number(existing.totalAmount);
    const tr = input.taxRate ?? Number(existing.taxRate);
    const r = calcTotals(ta, tr);
    taxAmount = new Prisma.Decimal(r.taxAmount);
    amountExcludingTax = new Prisma.Decimal(r.amountExcludingTax);
  }
  return prisma.$transaction(async (tx) => {
    const attachments = input.attachments
      ? await resolveAttachmentSnapshots(input.attachments, id, tx)
      : undefined;
    return tx.contract.update({
      where: { id },
      data: {
        ...input,
        signDate: input.signDate ? new Date(input.signDate) : undefined,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        totalAmount: input.totalAmount,
        taxRate: input.taxRate,
        taxAmount,
        amountExcludingTax,
        installmentPlan: input.installmentPlan as Prisma.InputJsonValue,
        attachments,
        updatedById: user.id
      }
    });
  });
}

// 状态机：submit / approve / reject / withdraw / terminate
export async function reviewContract(user: SessionUser, id: string, input: ReviewActionInput) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const c = await tx.contract.findFirst({ where: { id, deletedAt: null, ...ownerEq(user) } });
    if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
    if (input.action === "SUBMIT") {
      if (c.status !== "DRAFT") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 DRAFT 可提交", 403);
      if (!Array.isArray(c.attachments) || (c.attachments as unknown[]).length === 0) {
        throw new ApiError(ERROR_CODES.CONTRACT_INCOMPLETE, "请先上传合同盖章 PDF", 422);
      }
      const before = { status: c.status };
      const updated = await tx.contract.update({ where: { id }, data: { status: "PENDING_REVIEW" } });
      await tx.contractReviewLog.create({ data: { contractId: id, reviewerId: user.id, action: "SUBMIT" } });
      await audit(tx, { actorId: user.id, action: "CONTRACT_SUBMIT", entity: "Contract", entityId: id, before, after: { status: "PENDING_REVIEW" } });
      // 通知所有 ADMIN
      const admins = await listAdminUserIds(tx);
      await emit(tx, {
        type: "CONTRACT_PENDING_REVIEW",
        payload: { contractId: id, contractNo: c.contractNo, signDate: c.signDate },
        receivers: admins
      });
      return updated;
    }
    if (input.action === "APPROVE") {
      if (user.roleCode !== "ADMIN") throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可审批", 403);
      if (c.status !== "PENDING_REVIEW") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 PENDING_REVIEW 可批准", 403);
      const before = { status: c.status };
      const updated = await tx.contract.update({
        where: { id },
        data: { status: "EFFECTIVE", reviewerId: user.id, reviewAt: new Date() }
      });
      await tx.contractReviewLog.create({ data: { contractId: id, reviewerId: user.id, action: "APPROVE" } });
      await audit(tx, { actorId: user.id, action: "CONTRACT_APPROVE", entity: "Contract", entityId: id, before, after: { status: "EFFECTIVE" } });
      await emit(tx, {
        type: "CONTRACT_APPROVED",
        payload: { contractId: id, contractNo: c.contractNo, startDate: c.startDate },
        receivers: [c.ownerUserId]
      });
      return updated;
    }
    if (input.action === "REJECT") {
      if (user.roleCode !== "ADMIN") throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可驳回", 403);
      if (c.status !== "PENDING_REVIEW") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 PENDING_REVIEW 可驳回", 403);
      const before = { status: c.status };
      const updated = await tx.contract.update({
        where: { id },
        data: { status: "DRAFT", reviewerId: user.id, reviewAt: new Date(), reviewComment: input.comment ?? null }
      });
      await tx.contractReviewLog.create({ data: { contractId: id, reviewerId: user.id, action: "REJECT", comment: input.comment ?? null } });
      await audit(tx, { actorId: user.id, action: "CONTRACT_REJECT", entity: "Contract", entityId: id, before, after: { status: "DRAFT" } });
      await emit(tx, {
        type: "CONTRACT_REJECTED",
        payload: { contractId: id, contractNo: c.contractNo, comment: input.comment ?? null },
        receivers: [c.ownerUserId]
      });
      return updated;
    }
    if (input.action === "WITHDRAW") {
      if (c.status !== "PENDING_REVIEW") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 PENDING_REVIEW 可撤回", 403);
      const before = { status: c.status };
      const updated = await tx.contract.update({ where: { id }, data: { status: "DRAFT" } });
      await tx.contractReviewLog.create({ data: { contractId: id, reviewerId: user.id, action: "WITHDRAW" } });
      await audit(tx, { actorId: user.id, action: "CONTRACT_WITHDRAW", entity: "Contract", entityId: id, before, after: { status: "DRAFT" } });
      return updated;
    }
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未知动作", 400);
  });
}

export async function terminateContract(user: SessionUser, id: string, reason?: string) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.DELETE);
  if (user.roleCode !== "ADMIN") throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可终止合同", 403);
  return prisma.$transaction(async (tx) => {
    const c = await tx.contract.findFirst({ where: { id, deletedAt: null, ...ownerEq(user) } });
    if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
    if (!["EFFECTIVE", "EXECUTING"].includes(c.status)) {
      throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "当前状态不可终止", 403);
    }
    const before = { status: c.status };
    const updated = await tx.contract.update({
      where: { id },
      data: { status: "TERMINATED", reviewComment: reason ?? null, updatedById: user.id }
    });
    await audit(tx, { actorId: user.id, action: "CONTRACT_TERMINATE", entity: "Contract", entityId: id, before, after: { status: "TERMINATED" } });
    return updated;
  });
}

// 合同生命周期：执行 / 暂停 / 恢复 / 结清
// 与审批 (submit/approve/...) 不同,这组操作由已生效或已开始的合同走,无审批环节。
// 状态机：
//   EXECUTE   EFFECTIVE        → EXECUTING
//   SUSPEND   EXECUTING        → SUSPENDED
//   RESUME    SUSPENDED        → EXECUTING
//   COMPLETE  EFFECTIVE|EXECUTING|SUSPENDED → COMPLETED
export type LifecycleAction = "EXECUTE" | "SUSPEND" | "RESUME" | "COMPLETE";

const LIFECYCLE_TRANSITIONS: Record<LifecycleAction, { from: string[]; to: string }> = {
  EXECUTE:  { from: ["EFFECTIVE"],         to: "EXECUTING" },
  SUSPEND:  { from: ["EXECUTING"],         to: "SUSPENDED" },
  RESUME:   { from: ["SUSPENDED"],         to: "EXECUTING" },
  COMPLETE: { from: ["EFFECTIVE", "EXECUTING", "SUSPENDED"], to: "COMPLETED" }
};

export async function lifecycleContract(
  user: SessionUser,
  id: string,
  action: LifecycleAction,
  comment?: string
) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.UPDATE);
  if (user.roleCode !== "ADMIN") throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可操作合同生命周期", 403);

  const c = await prisma.contract.findFirst({ where: { id, deletedAt: null, ...ownerEq(user) } });
  if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);

  const t = LIFECYCLE_TRANSITIONS[action];
  if (!t.from.includes(c.status)) {
    throw new ApiError(
      ERROR_CODES.ENTITY_IMMUTABLE,
      `合同当前状态 ${c.status} 不允许 ${action}（须 ${t.from.join(" / ")}）`,
      403
    );
  }

  const before = { status: c.status };
  const updated = await prisma.contract.update({
    where: { id },
    data: { status: t.to, reviewComment: comment ?? c.reviewComment, updatedById: user.id }
  });
  // 记到合同专用的 review log(详情页时间线会拉这份),同时记到全局 audit
  await prisma.contractReviewLog.create({
    data: { contractId: id, reviewerId: user.id, action, comment: comment ?? null }
  });
  await audit(prisma, {
    actorId: user.id,
    action: `CONTRACT_${action}`,
    entity: "Contract",
    entityId: id,
    before,
    after: { status: t.to }
  });
  return updated;
}


// =====================================================
// P11: 合同 360 度视图
// =====================================================
export type ContractOverview = {
  projects: Array<{
    id: string;
    projectNo: string;
    name: string;
    status: string;
    startDate: string;
    endDate: string;
    managerUserId: string;
    workflowTaskCount: number;
    workflowCompleted: number;
  }>;
  invoices: Array<{
    id: string;
    invoiceNo: string;
    status: string;
    amount: string;
    applyDate: string;
    actualIssueDate: string | null;
  }>;
  payments: Array<{
    id: string;
    paymentNo: string;
    status: string;
    amount: string;
    receiveDate: string;
  }>;
  reviewLogs: Array<{
    id: string;
    action: string;
    reviewerId: string;
    comment: string | null;
    at: string;
  }>;
  totals: {
    projectCount: number;
    invoiceCount: number;
    paymentCount: number;
    totalAmount: number;
    invoicedAmount: number;
    paidAmount: number;
    billingStatus: BillingStatus;
    workflowTaskCount: number;
    workflowCompleted: number;
  };
};

export async function getContractOverview(
  user: SessionUser,
  contractId: string
): Promise<ContractOverview> {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);
  const c = await prisma.contract.findFirst({ where: { id: contractId, deletedAt: null, ...ownerEq(user) } });
  if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);

  const [projects, invoices, payments, reviewLogs] = await Promise.all([
    prisma.project.findMany({
      where: { contractId, deletedAt: null, ...(ownerViaContract(user) as Prisma.ProjectWhereInput) },
      include: { _count: { select: { taskInstances: { where: { deletedAt: null } } } } },
      orderBy: { createdAt: "desc" }
    }),
    prisma.invoice.findMany({
      where: { contractId, deletedAt: null, ...(ownerViaContract(user) as Prisma.InvoiceWhereInput) },
      orderBy: { applyDate: "desc" }
    }),
    prisma.payment.findMany({
      where: { contractId, deletedAt: null, ...(ownerViaContract(user) as Prisma.PaymentWhereInput) },
      orderBy: { receivedAt: "desc" }
    }),
    prisma.contractReviewLog.findMany({
      where: { contractId },
      orderBy: { at: "desc" },
      take: 50
    })
  ]);

  // 对每个项目查已完成工作流任务数(二次查)
  const projectWorkflowStats: Record<string, { completed: number; total: number }> = {};
  for (const p of projects) {
    const [completed, total] = await Promise.all([
      prisma.workflowTaskInstance.count({ where: { projectId: p.id, status: "COMPLETED", deletedAt: null } }),
      prisma.workflowTaskInstance.count({ where: { projectId: p.id, deletedAt: null } })
    ]);
    projectWorkflowStats[p.id] = { completed, total };
  }

  // 总数(与 server/services/statistics.ts:18-30 语义一致):
  //   invoicedAmount = sum(Invoice.amount)  where status=ISSUED         (red-flush 负数已含, 自动净额)
  //   paidAmount     = sum(Payment.amount)  where status IN (CONFIRMED,RECONCILED)
  let invoicedAmount = 0;
  for (const inv of invoices) if (inv.status === "ISSUED") invoicedAmount += Number(inv.amount);
  let paidAmount = 0;
  for (const p of payments) if (p.status === "CONFIRMED" || p.status === "RECONCILED") paidAmount += Number(p.amount);

  return {
    projects: projects.map((p) => ({
      id: p.id,
      projectNo: p.projectNo,
      name: p.name,
      status: p.status,
      startDate: p.startDate.toISOString(),
      endDate: p.endDate.toISOString(),
      managerUserId: p.managerUserId,
      workflowTaskCount: projectWorkflowStats[p.id]?.total ?? 0,
      workflowCompleted: projectWorkflowStats[p.id]?.completed ?? 0
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      status: i.status,
      amount: i.amount.toString(),
      applyDate: i.applyDate.toISOString(),
      actualIssueDate: i.actualIssueDate ? i.actualIssueDate.toISOString() : null
    })),
    payments: payments.map((p) => ({
      id: p.id,
      paymentNo: p.paymentNo,
      status: p.status,
      amount: p.amount.toString(),
      receiveDate: p.receivedAt.toISOString()
    })),
    reviewLogs: reviewLogs.map((r) => ({
      id: r.id,
      action: r.action,
      reviewerId: r.reviewerId,
      comment: r.comment,
      at: r.at.toISOString()
    })),
    totals: {
      projectCount: projects.length,
      invoiceCount: invoices.length,
      paymentCount: payments.length,
      totalAmount: Number(c.totalAmount),
      invoicedAmount,
      paidAmount,
      billingStatus: getBillingStatus(invoicedAmount, Number(c.totalAmount)),
      workflowTaskCount: projects.reduce((s, p) => s + (projectWorkflowStats[p.id]?.total ?? 0), 0),
      workflowCompleted: projects.reduce((s, p) => s + (projectWorkflowStats[p.id]?.completed ?? 0), 0)
    }
  };
}


/**
 * 软删除合同（仅 admin 可调用）。
 * 约束：
 *   - 状态必须是 DRAFT / PENDING_REVIEW（其他状态可能已有项目/开票/回款联动，需走 terminate/complete 走完生命周期）
 *   - 不能存在未删除的子项目 / 发票 / 回款 / 附件
 *   - 事务内写 deletedAt + audit log
 */
export async function softDeleteContract(user: SessionUser, id: string) {
  // 权限矩阵只给 ADMIN 配了 CONTRACT.DELETE，这里再显式断言一次，避免后续误改权限表
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.DELETE);
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可删除合同", 403);
  }
  return prisma.$transaction(async (tx) => {
    const existing = await tx.contract.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
    if (!["DRAFT", "PENDING_REVIEW"].includes(existing.status)) {
      throw new ApiError(
        ERROR_CODES.ENTITY_IMMUTABLE,
        `当前状态 ${existing.status} 不可删除（须 DRAFT / PENDING_REVIEW）`,
        403
      );
    }
    const [projectCount, invoiceCount, paymentCount, attachmentCount] = await Promise.all([
      tx.project.count({ where: { contractId: id, deletedAt: null } }),
      tx.invoice.count({ where: { contractId: id, deletedAt: null } }),
      tx.payment.count({ where: { contractId: id, deletedAt: null } }),
      tx.attachment.count({ where: { contractId: id, deletedAt: null } })
    ]);
    if (projectCount + invoiceCount + paymentCount + attachmentCount > 0) {
      throw new ApiError(
        ERROR_CODES.ENTITY_IMMUTABLE,
        `合同存在子数据（项目 ${projectCount} / 发票 ${invoiceCount} / 回款 ${paymentCount} / 附件 ${attachmentCount}），无法删除`,
        403
      );
    }
    const before = { status: existing.status, contractNo: existing.contractNo };
    const r = await tx.contract.update({
      where: { id },
      data: { deletedAt: new Date(), updatedById: user.id }
    });
    await audit(tx, {
      actorId: user.id,
      action: "CONTRACT_SOFT_DELETE",
      entity: "Contract",
      entityId: id,
      before,
      after: { deleted: true }
    });
    return r;
  });
}
