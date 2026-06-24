import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type {FollowUpCreateInput} from "@/lib/validators/customer";
import { Prisma } from "@prisma/client";

import {ownerEq, ownerViaContract} from "@/lib/ownership";
import { getCustomer } from "./crud";

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

