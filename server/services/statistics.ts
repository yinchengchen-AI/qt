// 统计服务：合同/开票/回款汇总 + 账龄 + Top10 + 业务人员业绩
import { prisma } from "@/lib/prisma";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";

type DateRange = { from?: Date; to?: Date };

function dateWhere(range: DateRange, _field: "actualIssueDate" | "receivedAt" | "signDate" = "signDate"): Prisma.DateTimeFilter {
  const w: Prisma.DateTimeFilter = {};
  if (range.from) w.gte = range.from;
  if (range.to) w.lte = range.to;
  return w;
}

function ownershipFilter(user: SessionUser): Prisma.ContractWhereInput {
  return user.roleCode === "SALES" ? { ownerUserId: user.id } : {};
}

// 1. 总览：合同额 / 已开票额 / 已回款额 / 未回款额
export async function getOverview(user: SessionUser, range: DateRange) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const where = { deletedAt: null, ...ownershipFilter(user) };
  const signWhere = { ...where, status: { in: ["EFFECTIVE", "EXECUTING", "COMPLETED"] }, signDate: dateWhere(range) };
  const [contractAgg, invoiceAgg, paymentAgg] = await Promise.all([
    prisma.contract.aggregate({ where: signWhere, _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.invoice.aggregate({
      where: {
        deletedAt: null,
        status: "ISSUED",
        actualIssueDate: dateWhere(range, "actualIssueDate"),
        ...(user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {})
      },
      _sum: { amount: true },
      _count: { _all: true }
    }),
    prisma.payment.aggregate({
      where: {
        deletedAt: null,
        status: { in: ["CONFIRMED", "RECONCILED"] },
        receivedAt: dateWhere(range, "receivedAt"),
        ...(user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {})
      },
      _sum: { amount: true },
      _count: { _all: true }
    })
  ]);
  const contractAmount = Number(contractAgg._sum.totalAmount ?? 0);
  const invoiceAmount = Number(invoiceAgg._sum.amount ?? 0);
  const paymentAmount = Number(paymentAgg._sum.amount ?? 0);
  return {
    contractAmount: round2(contractAmount),
    invoiceAmount: round2(invoiceAmount),
    paymentAmount: round2(paymentAmount),
    unpaidAmount: round2(invoiceAmount - paymentAmount),
    invoiceRate: contractAmount > 0 ? round2((invoiceAmount / contractAmount) * 100) : 0,
    paymentRate: invoiceAmount > 0 ? round2((paymentAmount / invoiceAmount) * 100) : 0,
    contractCount: contractAgg._count._all,
    invoiceCount: invoiceAgg._count._all,
    paymentCount: paymentAgg._count._all,
    range
  };
}

// 2. 时间序列（按月分组）
export async function getTimeSeries(user: SessionUser, range: DateRange) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  // 拉原始数据 → 在 JS 端分桶（更灵活，避免 PG generate_series + group by 复杂度）
  const from = range.from ?? new Date(Date.now() - 365 * 86400_000);
  const to = range.to ?? new Date();

  const [contracts, invoices, payments] = await Promise.all([
    prisma.contract.findMany({
      where: {
        deletedAt: null,
        status: { in: ["EFFECTIVE", "EXECUTING", "COMPLETED"] },
        signDate: { gte: from, lte: to },
        ...ownershipFilter(user)
      },
      select: { signDate: true, totalAmount: true }
    }),
    prisma.invoice.findMany({
      where: {
        deletedAt: null,
        status: "ISSUED",
        actualIssueDate: { gte: from, lte: to },
        ...(user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {})
      },
      select: { actualIssueDate: true, amount: true }
    }),
    prisma.payment.findMany({
      where: {
        deletedAt: null,
        status: { in: ["CONFIRMED", "RECONCILED"] },
        receivedAt: { gte: from, lte: to },
        ...(user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {})
      },
      select: { receivedAt: true, amount: true }
    })
  ]);

  // 生成月份键
  const months: string[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  const end = new Date(to.getFullYear(), to.getMonth(), 1);
  while (cursor <= end) {
    months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const buckets = new Map<string, { contract: number; invoice: number; payment: number }>();
  for (const m of months) buckets.set(m, { contract: 0, invoice: 0, payment: 0 });

  for (const c of contracts) {
    const k = `${new Date(c.signDate).getFullYear()}-${String(new Date(c.signDate).getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(k);
    if (b) b.contract += Number(c.totalAmount);
  }
  for (const i of invoices) {
    if (!i.actualIssueDate) continue;
    const k = `${new Date(i.actualIssueDate).getFullYear()}-${String(new Date(i.actualIssueDate).getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(k);
    if (b) b.invoice += Number(i.amount);
  }
  for (const p of payments) {
    const k = `${new Date(p.receivedAt).getFullYear()}-${String(new Date(p.receivedAt).getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(k);
    if (b) b.payment += Number(p.amount);
  }

  return months.map((m) => ({
    month: m,
    contractAmount: round2(buckets.get(m)!.contract),
    invoiceAmount: round2(buckets.get(m)!.invoice),
    paymentAmount: round2(buckets.get(m)!.payment)
  }));
}

// 3. 应收账款账龄
export async function getInvoiceAging(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const now = new Date();
  const invoices = await prisma.invoice.findMany({
    where: {
      deletedAt: null,
      status: "ISSUED",
      ...(user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {})
    },
    select: { id: true, invoiceNo: true, amount: true, actualIssueDate: true, customerId: true, customerName: true, contractId: true }
  });
  // 拉每张发票的已收金额
  const paid = await prisma.payment.groupBy({
    by: ["invoiceId"],
    where: { invoiceId: { in: invoices.map((i) => i.id) }, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null },
    _sum: { amount: true }
  });
  const paidMap = new Map<string, number>();
  for (const p of paid) paidMap.set(p.invoiceId!, Number(p._sum.amount ?? 0));

  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  const rows: Array<{ invoiceId: string; invoiceNo: string; customerName: string; daysOverdue: number; remaining: number; bucket: string }> = [];
  for (const inv of invoices) {
    if (!inv.actualIssueDate) continue;
    const days = Math.floor((now.getTime() - new Date(inv.actualIssueDate).getTime()) / 86400_000);
    const remain = Number(inv.amount) - (paidMap.get(inv.id) ?? 0);
    if (remain <= 0.01) continue;
    let bucket: keyof typeof buckets;
    if (days <= 30) bucket = "0-30";
    else if (days <= 60) bucket = "31-60";
    else if (days <= 90) bucket = "61-90";
    else bucket = "90+";
    buckets[bucket] = round2(buckets[bucket] + remain);
    rows.push({ invoiceId: inv.id, invoiceNo: inv.invoiceNo, customerName: inv.customerName, daysOverdue: days, remaining: round2(remain), bucket });
  }
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return { buckets, rows: rows.slice(0, 100) };
}

// 4. Top 客户（按合同额 / 回款额）
export async function getTopCustomers(user: SessionUser, metric: "contract" | "payment" = "contract", limit = 10) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const customers = await prisma.customer.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, code: true, level: true, customerType: true }
  });
  const result: Array<{ id: string; name: string; code: string; level: string; total: number; paymentTotal: number; invoiceTotal: number; contractCount: number }> = [];
  for (const c of customers) {
    const [contractAgg, invoiceAgg, paymentAgg, contractCount] = await Promise.all([
      prisma.contract.aggregate({
        where: { customerId: c.id, deletedAt: null, status: { in: ["EFFECTIVE", "EXECUTING", "COMPLETED"] } },
        _sum: { totalAmount: true }
      }),
      prisma.invoice.aggregate({
        where: { customerId: c.id, deletedAt: null, status: "ISSUED" },
        _sum: { amount: true }
      }),
      prisma.payment.aggregate({
        where: { customerId: c.id, deletedAt: null, status: { in: ["CONFIRMED", "RECONCILED"] } },
        _sum: { amount: true }
      }),
      prisma.contract.count({ where: { customerId: c.id, deletedAt: null, status: { in: ["EFFECTIVE", "EXECUTING", "COMPLETED"] } } })
    ]);
    const total = Number(contractAgg._sum.totalAmount ?? 0);
    if (total === 0 && Number(paymentAgg._sum.amount ?? 0) === 0) continue;
    result.push({
      id: c.id,
      name: c.name,
      code: c.code,
      level: c.level,
      total: round2(total),
      invoiceTotal: round2(Number(invoiceAgg._sum.amount ?? 0)),
      paymentTotal: round2(Number(paymentAgg._sum.amount ?? 0)),
      contractCount
    });
  }
  result.sort((a, b) => (metric === "contract" ? b.total - a.total : b.paymentTotal - a.paymentTotal));
  return result.slice(0, limit);
}

// 5. 业务人员业绩
export async function getSalesPerformance(user: SessionUser, targetUserId?: string, range?: DateRange) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const where = {
    deletedAt: null,
    ...(targetUserId ? { ownerUserId: targetUserId } : {}),
    ...(user.roleCode === "SALES" ? { ownerUserId: user.id } : {})
  };
  const owners = await prisma.user.findMany({
    where: { deletedAt: null, status: "ACTIVE", role: { code: "SALES" } },
    select: { id: true, name: true, employeeNo: true }
  });
  const out: Array<{ userId: string; name: string; employeeNo: string; contractAmount: number; invoiceAmount: number; paymentAmount: number; contractCount: number }> = [];
  for (const u of owners) {
    const [ca, ia, pa, cc] = await Promise.all([
      prisma.contract.aggregate({
        where: { ...where, ownerUserId: u.id, status: { in: ["EFFECTIVE", "EXECUTING", "COMPLETED"] }, ...(range ? { signDate: dateWhere(range) } : {}) },
        _sum: { totalAmount: true }
      }),
      prisma.invoice.aggregate({
        where: {
          contract: { ownerUserId: u.id },
          deletedAt: null,
          status: "ISSUED",
          ...(range ? { actualIssueDate: dateWhere(range, "actualIssueDate") } : {})
        },
        _sum: { amount: true }
      }),
      prisma.payment.aggregate({
        where: {
          contract: { ownerUserId: u.id },
          deletedAt: null,
          status: { in: ["CONFIRMED", "RECONCILED"] },
          ...(range ? { receivedAt: dateWhere(range, "receivedAt") } : {})
        },
        _sum: { amount: true }
      }),
      prisma.contract.count({
        where: { ...where, ownerUserId: u.id, status: { in: ["EFFECTIVE", "EXECUTING", "COMPLETED"] }, ...(range ? { signDate: dateWhere(range) } : {}) }
      })
    ]);
    out.push({
      userId: u.id,
      name: u.name,
      employeeNo: u.employeeNo,
      contractAmount: round2(Number(ca._sum.totalAmount ?? 0)),
      invoiceAmount: round2(Number(ia._sum.amount ?? 0)),
      paymentAmount: round2(Number(pa._sum.amount ?? 0)),
      contractCount: cc
    });
  }
  out.sort((a, b) => b.contractAmount - a.contractAmount);
  return out;
}

// 6. 客户分布
export async function getCustomerDistribution(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const [byLevel, byType, byStatus] = await Promise.all([
    prisma.customer.groupBy({ by: ["level"], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.customer.groupBy({ by: ["customerType"], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.customer.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } })
  ]);
  return {
    byLevel: byLevel.map((x) => ({ key: x.level, count: x._count._all })),
    byType: byType.map((x) => ({ key: x.customerType, count: x._count._all })),
    byStatus: byStatus.map((x) => ({ key: x.status, count: x._count._all }))
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
