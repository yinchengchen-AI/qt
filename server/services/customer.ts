import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { nextBusinessNo } from "@/lib/sequence";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { CustomerCreateInput, CustomerUpdateInput, FollowUpCreateInput } from "@/lib/validators/customer";
import { buildCustomerUpdateData } from "@/lib/customer-update";
import { Prisma } from "@prisma/client";
import { rlsTransaction } from "@/lib/rls";
import { ownerEq, ownerViaContract, parseStatusList } from "@/lib/ownership";
import { runTransitionInTx } from "@/lib/status-machine";
import { softDelete } from "@/lib/soft-delete";
import { ALLOWED_TRANSITIONS_BY_TARGET, isCustomerStatus } from "@/lib/customer-status-transitions";

export async function listCustomers(
  user: SessionUser,
  params: {
    page: number;
    pageSize: number;
    keyword?: string;
    status?: string;
    scale?: string;
    customerType?: string;
    industry?: string;
    // 地区级联 (省/市/区/镇街), 都用 equals 精确匹配 (前端 cascader 给的就是 DB 里的 label)
    province?: string;
    city?: string;
    district?: string;
    town?: string;
    ownerUserId?: string;
    createdAtFrom?: string;
    createdAtTo?: string;
  }
) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.READ);
  const { page, pageSize, keyword } = params;
  const statusList = parseStatusList(params.status);
  const scaleList = parseStatusList(params.scale);
  const customerTypeList = parseStatusList(params.customerType);
  const industryList = parseStatusList(params.industry);
  // createdAt 范围: 接受 ISO 字符串或 yyyy-MM-dd; 解析失败时按 undefined 处理, 不影响其他条件
  const fromDate = params.createdAtFrom ? new Date(params.createdAtFrom) : undefined;
  const toDate = params.createdAtTo ? new Date(params.createdAtTo) : undefined;
  const createdAtRange: Prisma.DateTimeFilter | undefined =
    fromDate && !Number.isNaN(fromDate.getTime()) && toDate && !Number.isNaN(toDate.getTime())
      ? { gte: fromDate, lte: toDate }
      : fromDate && !Number.isNaN(fromDate.getTime())
      ? { gte: fromDate }
      : toDate && !Number.isNaN(toDate.getTime())
      ? { lte: toDate }
      : undefined;
  const where: Prisma.CustomerWhereInput = {
    ...ownerEq(user),
    deletedAt: null,
    ...(statusList ? { status: { in: statusList } } : {}),
    ...(scaleList ? { scale: { in: scaleList } } : {}),
    ...(customerTypeList ? { customerType: { in: customerTypeList } } : {}),
    ...(industryList ? { industry: { in: industryList } } : {}),
    // 地区级联 (省/市/区/镇街): 前端 cascader 给的就是 DB label, 精确匹配
    ...(params.province ? { province: { equals: params.province, mode: "insensitive" } } : {}),
    ...(params.city ? { city: { equals: params.city, mode: "insensitive" } } : {}),
    ...(params.district ? { district: { equals: params.district, mode: "insensitive" } } : {}),
    ...(params.town ? { town: { equals: params.town, mode: "insensitive" } } : {}),
    // 负责人: 精确匹配 (SALES 角色受 ownerEq 限制, 传别人 id 自然返回空集, 符合预期)
    ...(params.ownerUserId ? { ownerUserId: params.ownerUserId } : {}),
    ...(createdAtRange ? { createdAt: createdAtRange } : {}),
    ...(keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: "insensitive" } },
            { shortName: { contains: keyword, mode: "insensitive" } },
            { code: { contains: keyword, mode: "insensitive" } },
            { contactPhone: { contains: keyword, mode: "insensitive" } }
          ]
        }
      : {})
  };
  const [list, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.customer.count({ where })
  ]);
  return { list, total, page, pageSize };
}

export async function getCustomer(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.READ);
  const c = await prisma.customer.findFirst({ where: { id, deletedAt: null, ...ownerEq(user) } });
  if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
  return c;
}

export async function createCustomer(user: SessionUser, input: CustomerCreateInput) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.CREATE);
  const code = await nextBusinessNo("CUSTOMER", { yyyymm: true });
  const ownerUserId = input.ownerUserId ?? user.id;  // 默认当前用户为负责人（admin 创建时也归自己）
  return rlsTransaction(prisma, user, async (tx) => { return tx.customer.create({
    data: {
      ...input,
      code,
      status: "LEAD",
      ownerUserId,
      unifiedSocialCreditCode: input.unifiedSocialCreditCode || null,
      shortName: input.shortName || null,
      industry: input.industry || null,
      scale: input.scale || null,
      address: input.address || null,
      district: input.district || null,
      town: input.town || null,
      contactName: input.contactName || null,
      contactTitle: input.contactTitle || null,
      sourceChannel: input.sourceChannel || null,
      createdById: user.id,
      updatedById: user.id
    }
  }); });
}

export async function updateCustomer(user: SessionUser, id: string, input: CustomerUpdateInput) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.customer.findFirst({ where: { id, deletedAt: null, ...ownerEq(user) } });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
    if (
      input.ownerUserId &&
      input.ownerUserId !== existing.ownerUserId &&
      user.roleCode !== "ADMIN"
    ) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可转移客户负责人", 403);
    }
    return tx.customer.update({
      where: { id },
      data: buildCustomerUpdateData(input, user.id)
    });
  });
}

// 客户状态机迁移入口
// 顺序: 行锁 + runTransitionInTx (loadInTx + from 检查 + precondition R-02/R-13 + update + audit)
// 事务隔离级别: Serializable (R-16); 行锁: SELECT ... FOR UPDATE 防止并发 PATCH 丢更新
// 状态不匹配时保留原 CUSTOMER_STATUS_TRANSITION_INVALID 错误码 (mismatchError 覆写抽象默认的 ENTITY_IMMUTABLE)
export async function changeCustomerStatus(
  user: SessionUser,
  id: string,
  status: string,
  reason?: string
) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.UPDATE);
  return prisma.$transaction(
    async (tx) => {
      // 行锁: 把目标行锁住, 防止两个并发 PATCH 抢同一行导致丢更新
      // Prisma 不直接暴露 FOR UPDATE, 用 $queryRaw 配合 Prisma.sql 模板保证参数化
      // SALES 角色只在有权限的行上加锁, 避免锁到无权访问的数据
      const ownerClause = user.roleCode === "SALES"
        ? Prisma.sql` AND "ownerUserId" = ${user.id}`
        : Prisma.sql``;
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "Customer" WHERE id = ${id}${ownerClause} FOR UPDATE`
      );
      if (locked.length === 0) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
      }
      // 校验目标状态是合法枚举 (防御性兜底, 与原 assertCanTransition 的 isCustomerStatus 检查一致)
      if (!isCustomerStatus(status)) {
        throw new ApiError(
          ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID,
          `客户状态变更目标非法: ${status}`,
          422,
        );
      }
      // 走 runTransitionInTx 做 from 检查 + precondition (业务校验) + update + audit
      const result = await runTransitionInTx(
        tx,
        {
          entity: "Customer",
          loadInTx: (t) => t.customer.findFirst({
            where: { id, deletedAt: null, ...ownerEq(user) },
            select: { id: true, status: true, name: true, ownerUserId: true },
          }),
          from: ALLOWED_TRANSITIONS_BY_TARGET[status] as readonly string[],
          to: status,
          // 1) 终态变更必填 reason: LOST / FROZEN 涉及"为什么"信息, 不允许无原因写入
          // 2) R-02: SIGNED 需至少 1 份生效中(ACTIVE)合同
          // 3) R-13: FROZEN 检查 — 先看活跃合同, 再看未对账回款 (顺序对应错误码提示)
          precondition: async (current, t) => {
            if ((status === "LOST" || status === "FROZEN") && !reason) {
              throw new ApiError(
                ERROR_CODES.CUSTOMER_STATUS_REASON_REQUIRED,
                `客户状态变更为 ${status} 需要填写原因`,
                422,
              );
            }
            if (status === "SIGNED") {
              const cnt = await t.contract.count({
                where: { customerId: id, status: "ACTIVE" },
              });
              if (cnt === 0) {
                throw new ApiError(ERROR_CODES.CUSTOMER_STATUS_INVALID, "客户需至少一份生效中的合同", 422);
              }
            }
            if (status === "FROZEN") {
              const activeContract = await t.contract.count({
                where: { customerId: id, status: { in: ["ACTIVE"] } },
              });
              if (activeContract > 0) {
                throw new ApiError(ERROR_CODES.CUSTOMER_HAS_ACTIVE_CONTRACT, "客户存在进行中合同,无法冻结", 422);
              }
              const activePayment = await t.payment.count({
                where: { customerId: id, status: { in: ["PLANNED", "CONFIRMED"] }, deletedAt: null },
              });
              if (activePayment > 0) {
                throw new ApiError(ERROR_CODES.CUSTOMER_FROZEN_ACTIVE_PAYMENT, "客户存在未对账回款,无法冻结", 422);
              }
            }
          },
          audit: (current) => ({
            actorId: user.id,
            action: "CUSTOMER_STATUS_CHANGE",
            before: { status: current.status },
            after: { status, ...(reason ? { reason } : {}) },
          }),
          // 状态不匹配时保留原 errorCode (CUSTOMER_STATUS_TRANSITION_INVALID, 422) — 与原 assertCanTransition 一致
          mismatchError: {
            code: ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID,
            status: 422,
            message: (current, to) => `客户状态 ${current.status} → ${to} 不允许`,
          },
        },
      );
      if (result.result === "SKIPPED") {
        throw new ApiError(
          ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID,
          `客户状态 ${status} 不允许`,
          422,
        );
      }
      // 拿回更新后的记录返回
      return result.updated ?? null;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 },
  );
}

export async function addFollowUp(user: SessionUser, customerId: string, input: FollowUpCreateInput) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.CREATE);
  // 行级隔离：先确认客户可见
  await getCustomer(user, customerId);
  return prisma.followUp.create({
    data: {
      customerId,
      userId: user.id,
      followAt: new Date(input.followAt),
      method: input.method,
      content: input.content,
      nextFollowAt: input.nextFollowAt ? new Date(input.nextFollowAt) : null,
      result: input.result ?? null
    }
  });
}

export async function listFollowUps(user: SessionUser, customerId: string) {
  await getCustomer(user, customerId);
  return prisma.followUp.findMany({
    where: { customerId, deletedAt: null },
    orderBy: { followAt: "desc" }
  });
}

export async function listCustomerContracts(user: SessionUser, customerId: string) {
  await getCustomer(user, customerId);
  return prisma.contract.findMany({
    where: { customerId, deletedAt: null },
    orderBy: { signDate: "desc" }
  });
}

export async function softDeleteCustomer(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.DELETE);
  const existing = await prisma.customer.findFirst({
    where: { id, deletedAt: null, ...ownerEq(user) },
    select: { id: true, status: true },
  });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
  return softDelete(user, {
    entity: "Customer",
    id,
    findInTx: (tx, customerId) => tx.customer.findFirst({
      where: { id: customerId, deletedAt: null, ...ownerEq(user) },
      select: { id: true, deletedAt: true },
    }),
    updateInTx: (tx, customerId, deletedAt, actorId) => tx.customer.update({
      where: { id: customerId },
      data: { deletedAt, updatedById: actorId },
      select: { id: true, deletedAt: true },
    }),
    preDeleteCheck: async (tx) => {
      // R-14: 若有 ACTIVE 合同禁止删除
      const active = await tx.contract.count({
        where: { customerId: id, status: { in: ["ACTIVE"] }, deletedAt: null },
      });
      if (active > 0) {
        throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "客户存在进行中合同，不可删除", 403);
      }
    },
    audit: {
      actorId: user.id,
      before: { status: existing.status },
    },
  });
}

// =====================================================
// P10: 客户 360 度视图 — 聚合 contracts/invoices/payments
// =====================================================
export type CustomerOverview = {
  contracts: Array<{
    id: string;
    contractNo: string;
    title: string;
    serviceType: string;
    status: string;
    signDate: string;
    startDate: string;
    endDate: string;
    totalAmount: string;
  }>;
  invoices: Array<{
    id: string;
    invoiceNo: string;
    status: string;
    amount: string;
    actualIssueDate: string | null;
    contractId: string;
    contractNo: string;
  }>;
  payments: Array<{
    id: string;
    paymentNo: string;
    status: string;
    amount: string;
    receiveDate: string;
    contractId: string;
    contractNo: string;
  }>;
  totals: {
    contractCount: number;
    invoiceCount: number;
    paymentCount: number;
    contractTotal: number; // 元
    invoicedTotal: number;
    paidTotal: number;
  };
};

export async function getCustomerOverview(
  user: SessionUser,
  customerId: string
): Promise<CustomerOverview> {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.READ);
  // 1. 客户存在性 + 行级隔离
  const c = await prisma.customer.findFirst({ where: { id: customerId, deletedAt: null, ...ownerEq(user) } });
  if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);

  // 2. 一次性查所有相关数据
  const contracts = await prisma.contract.findMany({
    where: { customerId, deletedAt: null, ...ownerEq(user) },
    orderBy: { signDate: "desc" }
  });
  const contractIds = contracts.map((c) => c.id);
  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: { contractId: { in: contractIds }, deletedAt: null, ...(ownerViaContract(user) as Prisma.InvoiceWhereInput) },
      orderBy: { applyDate: "desc" }
    }),
    prisma.payment.findMany({
      where: { contractId: { in: contractIds }, deletedAt: null, ...(ownerViaContract(user) as Prisma.PaymentWhereInput) },
      orderBy: { receivedAt: "desc" }
    })
  ]);
  // 合同号 map
  const contractNoMap = new Map(contracts.map((c) => [c.id, c.contractNo]));
  // 数字汇总(用 string 转为 number 累加,避开 Decimal 序列化问题)
  let contractTotal = 0;
  for (const ct of contracts) {
    contractTotal += Number(ct.totalAmount);
  }
  let invoicedTotal = 0;
  for (const inv of invoices) {
    invoicedTotal += Number(inv.amount);
  }
  let paidTotal = 0;
  for (const p of payments) {
    paidTotal += Number(p.amount);
  }
  return {
    contracts: contracts.map((c) => ({
      id: c.id,
      contractNo: c.contractNo,
      title: c.title,
      serviceType: c.serviceType,
      status: c.status,
      signDate: c.signDate.toISOString(),
      startDate: c.startDate.toISOString(),
      endDate: c.endDate.toISOString(),
      totalAmount: c.totalAmount.toString()
    })),
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      status: i.status,
      amount: i.amount.toString(),
      actualIssueDate: i.actualIssueDate ? i.actualIssueDate.toISOString() : null,
      contractId: i.contractId,
      contractNo: contractNoMap.get(i.contractId) ?? ""
    })),
    payments: payments.map((p) => ({
      id: p.id,
      paymentNo: p.paymentNo,
      status: p.status,
      amount: p.amount.toString(),
      receiveDate: p.receivedAt.toISOString(),
      contractId: p.contractId,
      contractNo: contractNoMap.get(p.contractId) ?? ""
    })),
    totals: {
      contractCount: contracts.length,
      invoiceCount: invoices.length,
      paymentCount: payments.length,
      contractTotal,
      invoicedTotal,
      paidTotal
    }
  };
}

// P13: 跟进 360 度视图 — 聚合所有客户跟进, 支持筛选
export type FollowUpOverviewItem = {
  id: string;
  customerId: string;
  customerName: string;
  userId: string;
  userName: string;
  followAt: string;
  method: string;
  content: string;
  nextFollowAt: string | null;
  result: string | null;
};

/**
 * 跟进 360 行级隔离决策:返回该角色是否能看全部客户的跟进数据
 * 注:不能用 CUSTOMER.EXPORT 代理——SALES/EXPERT 也有该权限(用于"导出自己客户数据"),
 *   复用会让他们越过行级隔离。
 */
export function canSeeAllFollowUps(roleCode: SessionUser["roleCode"]): boolean {
  return roleCode === "ADMIN" || roleCode === "FINANCE" || roleCode === "OPS";
}

export type FollowUpOverview = {
  items: FollowUpOverviewItem[];
  totals: { total: number; overdue: number; pending: number };
  byMethod: { method: string; count: number }[];
  byResult: { result: string; count: number }[];
};

export async function getFollowUpOverview(
  user: SessionUser,
  params: { days?: number; method?: string; result?: string; limit?: number }
): Promise<FollowUpOverview> {
  const canSeeAll = canSeeAllFollowUps(user.roleCode);
  const customerWhere: Record<string, unknown> = canSeeAll
    ? { deletedAt: null }
    : { deletedAt: null, ownerUserId: user.id };
  const customers = await prisma.customer.findMany({
    where: customerWhere as Prisma.CustomerWhereInput,
    select: { id: true, name: true, ownerUserId: true }
  });
  const customerIds = customers.map((c) => c.id);
  const customerMap = new Map(customers.map((c) => [c.id, c.name]));

  const daysAgo = params.days ? new Date(Date.now() - params.days * 86400000) : new Date(Date.now() - 180 * 86400000);
  const followFilter: Record<string, unknown> = {
    followAt: { gte: daysAgo },
    customerId: { in: customerIds },
    deletedAt: null
  };
  if (params.method) (followFilter as Record<string, unknown>).method = params.method;
  if (params.result) (followFilter as Record<string, unknown>).result = params.result;

  const followUps = await prisma.followUp.findMany({
    where: followFilter as Prisma.FollowUpWhereInput,
    orderBy: { followAt: "desc" },
    take: params.limit ?? 300
  });

  const [methodCounts, resultCounts, overdueCount] = await Promise.all([
    prisma.followUp.groupBy({
      by: ["method"],
      where: followFilter as Prisma.FollowUpWhereInput,
      _count: true,
      orderBy: { _count: { method: "desc" } }
    }),
    prisma.followUp.groupBy({
      by: ["result"],
      where: followFilter as Prisma.FollowUpWhereInput,
      _count: true,
      orderBy: { _count: { result: "desc" } }
    }),
    prisma.followUp.count({
      where: {
        ...(followFilter as Prisma.FollowUpWhereInput),
        nextFollowAt: { lt: new Date() },
        result: { notIn: ["SIGNED", "NO_INTENT"] },
        NOT: { nextFollowAt: null }
      }
    })
  ]);

  const userIds = Array.from(new Set(followUps.map((f) => f.userId)));
  const userMap = new Map((await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true }
  })).map((u) => [u.id, u.name]));

  const items: FollowUpOverviewItem[] = followUps.map((f) => ({
    id: f.id,
    customerId: f.customerId,
    customerName: customerMap.get(f.customerId) ?? "-",
    userId: f.userId,
    userName: userMap.get(f.userId) ?? "-",
    followAt: f.followAt.toISOString(),
    method: f.method,
    content: f.content,
    nextFollowAt: f.nextFollowAt?.toISOString() ?? null,
    result: f.result
  }));

  return {
    items,
    totals: {
      total: followUps.length,
      overdue: overdueCount,
      pending: resultCounts.find((r) => r.result === "PENDING")?._count ?? 0
    },
    byMethod: methodCounts.filter((m) => m.method).map((m) => ({ method: m.method!, count: m._count })),
    byResult: resultCounts.filter((r) => r.result).map((r) => ({ result: r.result!, count: r._count }))
  };
}
