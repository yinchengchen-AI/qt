import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { nextBusinessNo } from "@/lib/sequence";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { ContractCreateInput, ContractUpdateInput, ReviewActionInput } from "@/lib/validators/contract";
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
  const ids = [...new Set(raw.map((r) => r.id))];
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
  return found.map((a) => ({
    id: a.id,
    name: a.originalName,
    mimeType: a.mimeType,
    size: a.size,
    uploadedBy: a.uploadedById,
    uploadedAt: a.uploadedAt.toISOString()
  })) as unknown as Prisma.InputJsonValue;
}


function ownershipWhere(user: SessionUser): Prisma.ContractWhereInput {
  return user.roleCode === "SALES" ? { ownerUserId: user.id } : {};
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
  const where: Prisma.ContractWhereInput = {
    ...ownershipWhere(user),
    deletedAt: null,
    ...(status
      ? { status: { in: status.split(",").map((s) => s.trim()).filter(Boolean) } }
      : {}),
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
  return { list, total, page, pageSize };
}

export async function getContract(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);
  const c = await prisma.contract.findFirst({ where: { id, deletedAt: null, ...ownershipWhere(user) } });
  if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
  return c;
}

export async function createContract(user: SessionUser, input: ContractCreateInput) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.CREATE);
  // R-03
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, deletedAt: null } });
  if (!customer) throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
  if (!["NEGOTIATING", "SIGNED"].includes(customer.status)) {
    throw new ApiError(ERROR_CODES.CONTRACT_CUSTOMER_STATUS, "客户当前状态不允许新建合同", 422);
  }
  if (new Date(input.endDate) < new Date(input.startDate)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "结束日期不能早于开始日期", 400);
  }
  return prisma.$transaction(async (tx) => {
    const code = await nextBusinessNo("CONTRACT");
    const { taxAmount, amountExcludingTax } = calcTotals(input.totalAmount, input.taxRate);
    const created = await tx.contract.create({
      data: {
        contractNo: code,
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
  const existing = await prisma.contract.findFirst({ where: { id, deletedAt: null, ...ownershipWhere(user) } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
  if (!["DRAFT", "PENDING_REVIEW"].includes(existing.status)) {
    throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "当前状态不可修改", 403);
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
    const c = await tx.contract.findFirst({ where: { id, deletedAt: null, ...ownershipWhere(user) } });
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
  const c = await prisma.contract.findFirst({ where: { id, deletedAt: null, ...ownershipWhere(user) } });
  if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
  if (!["EFFECTIVE", "EXECUTING"].includes(c.status)) {
    throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "当前状态不可终止", 403);
  }
  return prisma.contract.update({
    where: { id },
    data: { status: "TERMINATED", reviewComment: reason ?? null, updatedById: user.id }
  });
}
