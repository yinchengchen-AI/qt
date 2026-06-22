// 统计服务：合同/开票/回款汇总 + 账龄 + Top10 + 业务人员业绩
import { prisma } from "@/lib/prisma";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";
import { ownerEq, ownerViaContract } from "@/lib/ownership";

type DateRange = { from?: Date; to?: Date };

function dateWhere(range: DateRange, _field: "actualIssueDate" | "receivedAt" | "signDate" = "signDate"): Prisma.DateTimeFilter {
  const w: Prisma.DateTimeFilter = {};
  if (range.from) w.gte = range.from;
  if (range.to) w.lte = range.to;
  return w;
}

// 1. 总览：合同额 / 已开票额 / 已回款额 / 未回款额
export async function getOverview(user: SessionUser, range: DateRange) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const where = { deletedAt: null, ...ownerEq(user) };
  const signWhere = { ...where, status: { in: ["ACTIVE", "CLOSED"] }, signDate: dateWhere(range) };
  const [contractAgg, invoiceAgg, paymentAgg] = await Promise.all([
    prisma.contract.aggregate({ where: signWhere, _sum: { totalAmount: true }, _count: { _all: true } }),
    prisma.invoice.aggregate({
      where: {
        deletedAt: null,
        status: "ISSUED",
        actualIssueDate: dateWhere(range, "actualIssueDate"),
        ...(ownerViaContract(user) as Prisma.InvoiceWhereInput)
      },
      _sum: { amount: true },
      _count: { _all: true }
    }),
    prisma.payment.aggregate({
      where: {
        deletedAt: null,
        status: { in: ["CONFIRMED", "RECONCILED"] },
        receivedAt: dateWhere(range, "receivedAt"),
        ...(ownerViaContract(user) as Prisma.PaymentWhereInput)
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
        status: { in: ["ACTIVE", "CLOSED"] },
        signDate: { gte: from, lte: to },
        ...ownerEq(user)
      },
      select: { signDate: true, totalAmount: true }
    }),
    prisma.invoice.findMany({
      where: {
        deletedAt: null,
        status: "ISSUED",
        actualIssueDate: { gte: from, lte: to },
        ...(ownerViaContract(user) as Prisma.InvoiceWhereInput)
      },
      select: { actualIssueDate: true, amount: true }
    }),
    prisma.payment.findMany({
      where: {
        deletedAt: null,
        status: { in: ["CONFIRMED", "RECONCILED"] },
        receivedAt: { gte: from, lte: to },
        ...(ownerViaContract(user) as Prisma.PaymentWhereInput)
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
      ...(ownerViaContract(user) as Prisma.InvoiceWhereInput)
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
// 实现:用 groupBy by customerId 一次拿全部客户的合同/开票/回款汇总,
// 把 1 + N×4 的 N+1 拍平为常数次(4)查询。
export async function getTopCustomers(user: SessionUser, metric: "contract" | "payment" = "contract", limit = 10) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const [customers, contractRows, invoiceRows, paymentRows] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, code: true, scale: true, customerType: true }
    }),
    prisma.contract.groupBy({
      by: ["customerId"],
      where: { deletedAt: null, status: { in: ["ACTIVE", "CLOSED"] } },
      _sum: { totalAmount: true },
      _count: { _all: true }
    }),
    prisma.invoice.groupBy({
      by: ["customerId"],
      where: { deletedAt: null, status: "ISSUED" },
      _sum: { amount: true }
    }),
    prisma.payment.groupBy({
      by: ["customerId"],
      where: { deletedAt: null, status: { in: ["CONFIRMED", "RECONCILED"] } },
      _sum: { amount: true }
    })
  ]);
  const contractByCustomer = new Map(contractRows.map((r) => [r.customerId, r]));
  const invoiceByCustomer = new Map(invoiceRows.map((r) => [r.customerId, Number(r._sum.amount ?? 0)]));
  const paymentByCustomer = new Map(paymentRows.map((r) => [r.customerId, Number(r._sum.amount ?? 0)]));

  const result = customers
    .map((c) => {
      const cr = contractByCustomer.get(c.id);
      const total = Number(cr?._sum.totalAmount ?? 0);
      const paymentTotal = paymentByCustomer.get(c.id) ?? 0;
      // 过滤掉无合同无回款的客户,减少噪声
      if (total === 0 && paymentTotal === 0) return null;
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        scale: c.scale,
        total: round2(total),
        invoiceTotal: round2(invoiceByCustomer.get(c.id) ?? 0),
        paymentTotal: round2(paymentTotal),
        contractCount: cr?._count._all ?? 0
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => (metric === "contract" ? b.total - a.total : b.paymentTotal - a.paymentTotal));
  return result.slice(0, limit);
}

// 5. 业务人员业绩
type PerformanceRow = {
  userId: string;
  name: string;
  employeeNo: string;
  contractAmount: number;
  invoiceAmount: number;
  paymentAmount: number;
  contractCount: number;
};

async function aggregatePerformance(owners: { id: string; name: string; employeeNo: string }[], range?: DateRange): Promise<PerformanceRow[]> {
  const signWhere = {
    deletedAt: null,
    status: { in: ["ACTIVE", "CLOSED"] },
    ...(range ? { signDate: dateWhere(range) } : {})
  };
  const invoiceWhere = {
    deletedAt: null,
    status: "ISSUED",
    ...(range ? { actualIssueDate: dateWhere(range, "actualIssueDate") } : {})
  };
  const paymentWhere = {
    deletedAt: null,
    status: { in: ["CONFIRMED", "RECONCILED"] },
    ...(range ? { receivedAt: dateWhere(range, "receivedAt") } : {})
  };

  // 1) 合同总额 + 合同数:groupBy by ownerUserId 一次拿全
  const ownerIds = owners.map((o) => o.id);
  const [contractRows, invoiceRows, paymentRows] = await Promise.all([
    prisma.contract.groupBy({
      by: ["ownerUserId"],
      where: { ...signWhere, ownerUserId: { in: ownerIds } },
      _sum: { totalAmount: true },
      _count: { _all: true }
    }),
    prisma.invoice.groupBy({
      by: ["contractId"],
      where: { ...invoiceWhere, contract: { ownerUserId: { in: ownerIds } } },
      _sum: { amount: true }
    }),
    prisma.payment.groupBy({
      by: ["contractId"],
      where: { ...paymentWhere, contract: { ownerUserId: { in: ownerIds } } },
      _sum: { amount: true }
    })
  ]);
  // 2) contractId -> ownerUserId 反查,累加到对应 owner
  const contractOwners = await prisma.contract.findMany({
    where: { id: { in: [...new Set([...invoiceRows.map((r) => r.contractId), ...paymentRows.map((r) => r.contractId)].filter(Boolean) as string[])] } },
    select: { id: true, ownerUserId: true }
  });
  const contractOwnerMap = new Map(contractOwners.map((c) => [c.id, c.ownerUserId]));

  const sumByOwner = new Map<string, { invoice: number; payment: number }>();
  for (const r of invoiceRows) {
    const owner = contractOwnerMap.get(r.contractId);
    if (!owner) continue;
    const cur = sumByOwner.get(owner) ?? { invoice: 0, payment: 0 };
    cur.invoice += Number(r._sum.amount ?? 0);
    sumByOwner.set(owner, cur);
  }
  for (const r of paymentRows) {
    const owner = contractOwnerMap.get(r.contractId);
    if (!owner) continue;
    const cur = sumByOwner.get(owner) ?? { invoice: 0, payment: 0 };
    cur.payment += Number(r._sum.amount ?? 0);
    sumByOwner.set(owner, cur);
  }

  const out: PerformanceRow[] = owners.map((u) => {
    const cr = contractRows.find((r) => r.ownerUserId === u.id);
    const ip = sumByOwner.get(u.id) ?? { invoice: 0, payment: 0 };
    return {
      userId: u.id,
      name: u.name,
      employeeNo: u.employeeNo,
      contractAmount: round2(Number(cr?._sum.totalAmount ?? 0)),
      invoiceAmount: round2(ip.invoice),
      paymentAmount: round2(ip.payment),
      contractCount: cr?._count._all ?? 0
    };
  });
  out.sort((a, b) => b.contractAmount - a.contractAmount);
  return out;
}

export async function getSalesPerformance(user: SessionUser, targetUserId?: string, range?: DateRange) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  // SALES 角色：只能看自己,直接 short-circuit (避免下面循环把别人全填 0)
  if (user.roleCode === "SALES") {
    return aggregatePerformance(
      [{ id: user.id, name: user.name, employeeNo: user.employeeNo }],
      range
    );
  }
  // ADMIN / FINANCE: 可看全员(或指定 targetUserId 单人)
  const owners = await prisma.user.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      role: { code: "SALES" },
      ...(targetUserId ? { id: targetUserId } : {})
    },
    select: { id: true, name: true, employeeNo: true }
  });
  return aggregatePerformance(owners, range);
}

// 6. 客户分布
export async function getCustomerDistribution(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const [byScale, byType, byStatus] = await Promise.all([
    prisma.customer.groupBy({ by: ["scale"], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.customer.groupBy({ by: ["customerType"], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.customer.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } })
  ]);
  return {
    byScale: byScale.map((x) => ({ key: x.scale, count: x._count._all })),
    byType: byType.map((x) => ({ key: x.customerType, count: x._count._all })),
    byStatus: byStatus.map((x) => ({ key: x.status, count: x._count._all }))
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
