import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { ContractCreateInput, ContractUpdateInput } from "@/lib/validators/contract";

import {ownerEq, parseStatusList} from "@/lib/ownership";
import { getBillingStatus } from "@/lib/contract-billing";
import { Prisma } from "@prisma/client";
import { calcTaxBreakdown } from "@/lib/money";
import { resolveAttachmentSnapshots } from "@/lib/attachment-snapshot";
import { softDelete } from "@/lib/soft-delete";
import { tryAutoPublish } from "./status";
import { onContractActivated } from "@/server/services/customer/automation";

function assertDateOrder(start?: string | Date | null, end?: string | Date | null, label = "服务"): void {
  if (!start || !end) return;
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return;
  if (e.getTime() <= s.getTime()) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}止期必须晚于起期`, 400);
  }
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

  // 批量回填负责人姓名 (ownerName), 列表/详情表头展示用; 避免 N+1
  const ownerIds = Array.from(new Set(list.map((c) => c.ownerUserId).filter(Boolean)));
  const owners = ownerIds.length
    ? await prisma.user.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, employeeNo: true } })
    : [];
  const ownerById = new Map(owners.map((u) => [u.id, u]));

  const enriched = list.map((c) => {
    const invoicedAmount = invoicedByContract.get(c.id) ?? 0;
    const paidAmount = paidByContract.get(c.id) ?? 0;
    const owner = ownerById.get(c.ownerUserId);
    return {
      ...c,
      invoicedAmount,
      paidAmount,
      billingStatus: getBillingStatus(invoicedAmount, Number(c.totalAmount)),
      ownerName: owner?.name ?? "",
      ownerEmployeeNo: owner?.employeeNo ?? ""
    };
  });
  return { list: enriched, total, page, pageSize };
}


export async function getContract(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);
  const c = await prisma.contract.findFirst({
    where: { id, deletedAt: null, ...ownerEq(user) },
    include: {
      customer: {
        select: { contactName: true, contactPhone: true }
      },
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
  // 投影负责人姓名,详情页头部展示; 跟 reviewer 走同一套"白名单投影"模式避免越权泄露其他 user 字段
  const owner = await prisma.user.findFirst({
    where: { id: c.ownerUserId, deletedAt: null },
    select: { id: true, name: true, employeeNo: true }
  });
  // 投影 reviewer 姓名(批量查避免 N+1),只返回 id + name
  const reviewerIds = Array.from(new Set(c.reviewLogs.map((l) => l.reviewerId).filter(Boolean)));
  const reviewers = reviewerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: reviewerIds } },
        select: { id: true, name: true }
      })
    : [];
  const nameById = new Map(reviewers.map((u) => [u.id, u.name]));
  const customerContact = c.customer?.contactPhone
    ? `${c.customer.contactName ?? ""} ${c.customer.contactPhone}`.trim()
    : "";
  return {
    ...c,
    customerContact,
    ownerName: owner?.name ?? "",
    ownerEmployeeNo: owner?.employeeNo ?? "",
    reviewLogs: c.reviewLogs.map((l) => ({
      id: l.id,
      action: l.action,
      comment: l.comment,
      at: l.at,
      reviewerId: l.reviewerId,
      reviewerName: nameById.get(l.reviewerId) ?? ""
    }))
    // 合同结构化交付物 (JSON) 已下线, 详情 tab 内上传实际交付文件
  };
}

// 校验"签订人 / 负责人"等指派字段:用户必须存在、未软删、ACTIVE.
// 单独抽出来避免 createContract / updateContract 各自重复 3 行.

async function assertActiveUser(userId: string, label: string): Promise<void> {
  const u = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
  if (!u) throw new ApiError(ERROR_CODES.NOT_FOUND, `${label}不存在`, 404);
  if (u.status !== "ACTIVE") {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `${label}必须是启用状态员工`, 400);
  }
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
  await assertActiveUser(signerId, "签订人");
  // 校验负责人:前端不传时回退为客户业务负责人(customer.ownerUserId);
  // 显式传入时同样要目标用户 ACTIVE, 防止前端传错 id 静默落到一个停用员工头上.
  const ownerUserId = input.ownerUserId ?? customer.ownerUserId;
  await assertActiveUser(ownerUserId, "负责人");
  assertDateOrder(input.startDate, input.endDate);
  // 合同编号唯一性:DB 上是部分唯一索引 WHERE "deletedAt" IS NULL, 软删合同不阻塞同号新建.
  // 活动行唯一性在这里显式预校验, 提前抛 422; 事务内 create 仍可能因并发竞态触发 P2002, 在下面 catch 兜底.
  const existingNo = await prisma.contract.findFirst({ where: { contractNo: input.contractNo, deletedAt: null } });
  if (existingNo) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `合同编号 ${input.contractNo} 已被使用`, 422);
  }
  return prisma.$transaction(async (tx) => {
    const { taxAmount, amountExcludingTax } = calcTaxBreakdown(input.totalAmount, input.taxRate);
    let created;
    try {
      created = await tx.contract.create({
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
        ownerUserId,
        remark: input.remark ?? null,
        installmentPlan: (input.installmentPlan ?? null) as Prisma.InputJsonValue,
        // 合同结构化交付物 (JSON) 已下线; 实际交付文件走 Attachment.isDeliverable
        status: "DRAFT",
        attachments: [] as unknown as Prisma.InputJsonValue,
        createdById: user.id,
        updatedById: user.id
      }
      });
    } catch (e) {
      // 并发场景: 预校验和 create 之间被另一笔创建抢了同号, 把它转成 422 而不是漏 500
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `合同编号 ${input.contractNo} 已被使用`, 422);
      }
      throw e;
    }
    // 解析附件并绑定(tmp -> contractId),把真实记录写回 JSON 快照
    if ((input.attachments ?? []).length > 0) {
      const attachments = await resolveAttachmentSnapshots(input.attachments ?? [], "Contract", created.id, tx);
      await tx.contract.update({ where: { id: created.id }, data: { attachments } });
    }
    // 自动化: 字段完整 + 至少 1 附件 → DRAFT 自动升 ACTIVE (在事务内, 失败时回滚)
    const publishResult = await tryAutoPublish(tx, created.id);
    return { id: created.id, publishResult };
  }).then(async ({ id, publishResult }) => {
    // 客户状态机联动 (§2.3): 合同自动升 ACTIVE 后, 尝试把客户自动改为 SIGNED.
    // 不能在原 $transaction 里嵌套调 (Prisma 7 不支持嵌套事务), 在事务结束后独立事务跑.
    // tryAutoPublish 已 DONE 时才触发, 避免无意义的 SYSTEM_USER 写; 客户 auto-write 自身
    // 失败是 silentSkip, 不影响合同已成功的状态.
    if (publishResult === "PUBLISHED") {
      await onContractActivated(id);
    }
    return prisma.contract.findUnique({ where: { id } });
  });
}


export async function updateContract(user: SessionUser, id: string, input: ContractUpdateInput) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.UPDATE);
  const existing = await prisma.contract.findFirst({ where: { id, deletedAt: null, ...ownerEq(user) } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
  // 状态机门控: admin 任意态可改; 非 admin 仅 DRAFT 可改 (新模型下 PENDING_REVIEW/SUSPENDED 已合并入 ACTIVE)
  if (user.roleCode !== "ADMIN" && existing.status !== "DRAFT") {
    throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "当前状态不可修改", 403);
  }
  // 防御: 即使调用方通过某种方式传了 customerId / signerId / status,service 层也显式丢弃,
  // 防止 spread 时把这些字段写进 DB
  const safeInput = { ...input } as Record<string, unknown>;
  delete safeInput.customerId;
  delete safeInput.signerId;
  delete safeInput.status;

  // 负责人变更时, 校验目标用户存在且 ACTIVE
  if (input.ownerUserId !== undefined && input.ownerUserId !== existing.ownerUserId) {
    await assertActiveUser(input.ownerUserId, "负责人");
  }
  // 日期顺序校验(与编辑页一致:止期必须晚于起期)
  assertDateOrder(input.startDate ?? existing.startDate, input.endDate ?? existing.endDate);
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
    const r = calcTaxBreakdown(ta, tr);
    taxAmount = r.taxAmount;
    amountExcludingTax = r.amountExcludingTax;
  }
  const wasDraft = existing.status === "DRAFT";
  return prisma.$transaction(async (tx) => {
    const attachments = input.attachments
      ? await resolveAttachmentSnapshots(input.attachments, "Contract", id, tx)
      : undefined;
    try {
      const updated = await tx.contract.update({
      where: { id },
        data: {
          ...(safeInput as ContractUpdateInput),
          signDate: input.signDate ? new Date(input.signDate) : undefined,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          totalAmount: input.totalAmount,
          taxRate: input.taxRate,
          taxAmount,
          amountExcludingTax,
          installmentPlan: input.installmentPlan as Prisma.InputJsonValue,
          // 合同结构化交付物 (JSON) 已下线, PATCH 不再处理 deliverables 字段
          attachments,
          updatedById: user.id
        }
      });
      // 自动化: PATCH 一次性补齐字段/附件时, DRAFT 也可能升 ACTIVE
      const publishResult = wasDraft ? await tryAutoPublish(tx, id) : ("SKIPPED" as const);
      return { updated, publishResult };
    } catch (e) {
      // 同 createContract: 并发把 contractNo 抢走时把 P2002 转 422
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `合同编号 ${input.contractNo ?? ""} 已被使用`, 422);
      }
      throw e;
    }
  }).then(async ({ updated, publishResult }) => {
    // 客户状态机联动 (§2.3): 同 createContract
    if (publishResult === "PUBLISHED") {
      await onContractActivated(id);
    }
    return updated;
  });
}


// 状态机: 草稿(DRAFT) / 生效中(ACTIVE) / 已完结(CLOSED) 三个值.
// 入口: tryAutoPublish (DRAFT→ACTIVE, 字段完整+附件) / tryAutoClose (ACTIVE→CLOSED, R-07: 开票+回款双足额) /
//       publishContract (admin 强制 DRAFT→ACTIVE) /
//       closeContract (admin 强制 ACTIVE→CLOSED).
// 状态机不再审批; 业务自创建/维护, admin 兜底; 时间线上以 ContractReviewLog.action 区分自动/手动.

/**
 * 强制发布: admin 手动从 DRAFT 推到 ACTIVE.
 * 通常不需要, save 时已自动触发; 这里是兜底入口, 便于 admin 在字段/附件不满足自动条件时强制生效.
 */

export async function softDeleteContract(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.DELETE);
  // 显式双检: 防止以后误改 ROLE_PERMISSIONS 表 (例如给 SALES 加了 DELETE) 而悄悄放权.
  // 合同软删是 admin-only 的高敏操作.
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可删除合同", 403);
  }
  // 加载 preDelete 所需的 existing 状态(必须在事务外,因为 softDelete 内部不再读它)
  const existing = await prisma.contract.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, status: true, contractNo: true },
  });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
  return softDelete(user, {
    entity: "Contract",
    id,
    findInTx: (tx, contractId) => tx.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, deletedAt: true },
    }),
    updateInTx: (tx, contractId, deletedAt, actorId) => tx.contract.update({
      where: { id: contractId },
      data: { deletedAt, updatedById: actorId },
      select: { id: true, deletedAt: true },
    }),
    preDeleteCheck: async (tx) => {
      const [invoiceCount, paymentCount, attachmentCount] = await Promise.all([
        tx.invoice.count({ where: { contractId: id, deletedAt: null } }),
        tx.payment.count({ where: { contractId: id, deletedAt: null } }),
        tx.attachment.count({ where: { contractId: id, deletedAt: null } }),
      ]);
      if (invoiceCount + paymentCount + attachmentCount > 0) {
        throw new ApiError(
          ERROR_CODES.ENTITY_IMMUTABLE,
          `合同存在子数据(发票 ${invoiceCount} / 回款 ${paymentCount} / 附件 ${attachmentCount}), 无法删除`,
          403,
        );
      }
    },
    audit: {
      actorId: user.id,
      before: { status: existing.status, contractNo: existing.contractNo },
    },
  });
}


// =====================================================
// 合同状态机自动转换 (Q4)
// =====================================================
//
// 静默可重入: 状态不匹配 → no-op, 不抛错, 避免拖垮调用方主事务.
// 失败时写 audit log 但仍然 throw(自动转换失败应当可见), 调用方决定是否吞掉.
//
// 写入者统一为 SYSTEM_USER_ID ("system"). 该用户在迁移 20260621_user_is_system 中创建,
// passwordHash 是非法 bcrypt 永远登录不了; lib/auth.ts 登录路径 / bus.ts listAdminUserIds /
// workflow 都已过滤 isSystem=true.
//
// 自动转换的 audit action 串:
//   CONTRACT_AUTO_EXPIRE    - 定时任务扫到 endDate < now 时 → EXPIRED
// ContractReviewLog.action 同步写, 详情页时间线可见.

/**
 * 单笔合同过期检查: endDate < now 且 status = ACTIVE → CLOSED (reason=expired).
 * 内部用 Serializable 事务 + P2034 重试 3 次 (与 softDeleteContract 相同的并发模式).
 * 状态不匹配 → no-op (静默), 适用于"批量扫描 + 单笔隔离"模式.
 * 跑在 /api/jobs/run-all, 每天 1 次, 调用方传入 now.
 */
