// 统计服务：合同/开票/回款汇总 + 账龄 + Top10 + 业务人员业绩
import { prisma } from "@/lib/prisma";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";
import { ownerEq, ownerViaContract } from "@/lib/ownership";
import type { DateRange } from "@/lib/date-range";

/**
 * 构造 Prisma DateTimeFilter。fieldName 仅用于在调用处自注释作用字段,
 * 函数本身不依赖字段名（所有日期字段的 filter 结构相同）。
 */
function dateWhere(range: DateRange, _fieldName: "actualIssueDate" | "receivedAt" | "signDate" = "signDate"): Prisma.DateTimeFilter {
  const w: Prisma.DateTimeFilter = {};
  if (range.from) w.gte = range.from;
  if (range.to) w.lte = range.to;
  return w;
}

/** 按 UTC 日历日计算两个 Date 之间的整数天数,避免 86400_000 ms 法在 DST/时区边界差一天 */
function daysBetween(later: Date, earlier: Date): number {
  const a = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
  const b = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
  return Math.floor((a - b) / 86_400_000);
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
  // 未回款 = 已开票 - 已回款。paymentAmount 包含未挂账到发票的预付款,
  // 可能大于 invoiceAmount(此时算出的"未回款"为负),clamp 到 0 防止出现 -¥X
  const unpaidRaw = invoiceAmount - paymentAmount;
  return {
    contractAmount: round2(contractAmount),
    invoiceAmount: round2(invoiceAmount),
    paymentAmount: round2(paymentAmount),
    unpaidAmount: round2(Math.max(0, unpaidRaw)),
    invoiceRate: contractAmount > 0 ? round2((invoiceAmount / contractAmount) * 100) : 0,
    paymentRate: invoiceAmount > 0 ? round2((paymentAmount / invoiceAmount) * 100) : 0,
    contractCount: contractAgg._count._all,
    invoiceCount: invoiceAgg._count._all,
    paymentCount: paymentAgg._count._all
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
    const d = new Date(c.signDate);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(k);
    if (b) b.contract += Number(c.totalAmount);
  }
  for (const i of invoices) {
    if (!i.actualIssueDate) continue;
    const d = new Date(i.actualIssueDate);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(k);
    if (b) b.invoice += Number(i.amount);
  }
  for (const p of payments) {
    const d = new Date(p.receivedAt);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
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
// 返回: { buckets, rows, total }
//   - buckets: 各账龄段总未收金额
//   - rows: 逐张超期发票,按 daysOverdue 降序
//   - total: 全部超期发票数(可能大于 rows.length,前端用于显示真实总数)
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
  // 拉每张发票的"仍生效"回款:只算 CONFIRMED/RECONCILED,REFUNDED 视为已撤销
  // (注意:仅聚合与发票挂账的回款;invoiceId 为 null 的预付款不影响本张发票)
  // schema 的 refund 动作是直接把原 payment 的 status 翻成 REFUNDED(amount 不变),
  // 所以"已退款的回款"靠排除该 status 实现,不引入符号抵消(否则会高估应收)
  const paid = await prisma.payment.groupBy({
    by: ["invoiceId"],
    where: {
      invoiceId: { in: invoices.map((i) => i.id) },
      status: { in: ["CONFIRMED", "RECONCILED"] },
      deletedAt: null
    },
    _sum: { amount: true }
  });
  const paidMap = new Map<string, number>();
  for (const p of paid) paidMap.set(p.invoiceId!, Number(p._sum.amount ?? 0));

  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  const rows: Array<{ invoiceId: string; invoiceNo: string; customerName: string; daysOverdue: number; remaining: number; bucket: string }> = [];
  for (const inv of invoices) {
    if (!inv.actualIssueDate) continue;
    const days = daysBetween(now, new Date(inv.actualIssueDate));
    // 0.01 容差,refunded 多于 confirmed 时 remain 不会变成显著负数影响分桶
    const remain = Number(inv.amount) - (paidMap.get(inv.id) ?? 0);
    if (remain <= 0.01) continue;
    let bucket: keyof typeof buckets;
    if (days < 0) bucket = "90+"; // 开票日在未来(时钟漂移/录错)归最高风险段
    else if (days <= 30) bucket = "0-30";
    else if (days <= 60) bucket = "31-60";
    else if (days <= 90) bucket = "61-90";
    else bucket = "90+";
    buckets[bucket] = round2(buckets[bucket] + remain);
    rows.push({ invoiceId: inv.id, invoiceNo: inv.invoiceNo, customerName: inv.customerName, daysOverdue: days, remaining: round2(remain), bucket });
  }
  rows.sort((a, b) => b.daysOverdue - a.daysOverdue);
  return { buckets, total: rows.length, rows: rows.slice(0, 100) };
}

// 4. Top 客户（按合同额 / 回款额）
// 实现:用 groupBy by customerId 一次拿全部客户的合同/开票/回款汇总,
// 把 1 + N×4 的 N+1 拍平为常数次(4)查询。
// range 可选:不传则全量,传则按 signDate / actualIssueDate / receivedAt 同时过滤。
export async function getTopCustomers(user: SessionUser, metric: "contract" | "payment" = "contract", limit = 10, range?: DateRange) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const signWhere = { deletedAt: null, status: { in: ["ACTIVE", "CLOSED"] }, ...(range ? { signDate: dateWhere(range) } : {}), ...ownerEq(user) };
  const invoiceWhere = { deletedAt: null, status: "ISSUED", ...(range ? { actualIssueDate: dateWhere(range, "actualIssueDate") } : {}), ...(ownerViaContract(user) as Prisma.InvoiceWhereInput) };
  const paymentWhere = { deletedAt: null, status: { in: ["CONFIRMED", "RECONCILED"] }, ...(range ? { receivedAt: dateWhere(range, "receivedAt") } : {}), ...(ownerViaContract(user) as Prisma.PaymentWhereInput) };
  const [customers, contractRows, invoiceRows, paymentRows] = await Promise.all([
    prisma.customer.findMany({
      where: { deletedAt: null, ...ownerEq(user) } as Prisma.CustomerWhereInput,
      select: { id: true, name: true, code: true, scale: true, customerType: true }
    }),
    prisma.contract.groupBy({
      by: ["customerId"],
      where: signWhere as Prisma.ContractWhereInput,
      _sum: { totalAmount: true },
      _count: { _all: true }
    }),
    prisma.invoice.groupBy({
      by: ["customerId"],
      where: invoiceWhere,
      _sum: { amount: true }
    }),
    prisma.payment.groupBy({
      by: ["customerId"],
      where: paymentWhere,
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
      // 按所选 metric 过滤:合同模式下没有合同额的客户不进榜;
      // 回款模式下没有回款的客户不进榜;但 invoiceTotal 仍然返回,供前端展示
      if (metric === "contract" && total === 0) return null;
      if (metric === "payment" && paymentTotal === 0) return null;
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
  // 只反查在 ownerIds 内的合同,避免拉取不相关人员的合同(性能 + 内存)
  const contractIds = [...new Set([...invoiceRows.map((r) => r.contractId), ...paymentRows.map((r) => r.contractId)].filter(Boolean) as string[])];
  const contractOwners = contractIds.length > 0
    ? await prisma.contract.findMany({
        where: { id: { in: contractIds }, ownerUserId: { in: ownerIds } },
        select: { id: true, ownerUserId: true }
      })
    : [];
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

export async function getEmployeePerformance(user: SessionUser, targetUserId?: string, range?: DateRange) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  // SALES 角色：只能看自己,直接 short-circuit (避免下面循环把别人全填 0)
  if (user.roleCode === "SALES") {
    return aggregatePerformance(
      [{ id: user.id, name: user.name, employeeNo: user.employeeNo }],
      range
    );
  }
  // 其它角色: 统计所有非系统、非管理员的 ACTIVE 员工 (或指定 targetUserId 单人)
  // - isSystem=false 排除合同状态机等内部用的 system actor
  // - role.code != "ADMIN" 排除管理员 (管理员不背业绩, 不进排行)
  const owners = await prisma.user.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      isSystem: false,
      role: { code: { not: "ADMIN" } },
      ...(targetUserId ? { id: targetUserId } : {})
    },
    select: { id: true, name: true, employeeNo: true },
    orderBy: { employeeNo: "asc" }
  });
  return aggregatePerformance(owners, range);
}

// 6. 客户分布
export async function getCustomerDistribution(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const customerWhere = { deletedAt: null, ...ownerEq(user) } as Prisma.CustomerWhereInput;
  const [byScale, byType] = await Promise.all([
    prisma.customer.groupBy({ by: ["scale"], where: customerWhere, _count: { _all: true } }),
    prisma.customer.groupBy({ by: ["customerType"], where: customerWhere, _count: { _all: true } })
  ]);
  return {
    byScale: byScale.map((x) => ({ key: x.scale, count: x._count._all })),
    byType: byType.map((x) => ({ key: x.customerType, count: x._count._all }))
  };
}

// 7. 按客户所在区域（镇街）汇总合同 / 开票 / 回款
// 实现参考 getTopCustomers:4 次常数查询（customers + contracts/invoices/payments 各自的 groupBy by customerId),
// 用 Map<customerId, town> 反查定位区域,JS 端按 region 桶累加。无合同/开票/回款的客户不进榜。
// - region 粒度固定为 Customer.town；town 为 null 的客户聚合到 "未填写" 一行,排最末
// - SALES 角色行级隔离:customers/contracts 走 ownerEq, invoices/payments 走 ownerViaContract
// - range 同时作用于 signDate / actualIssueDate / receivedAt, 语义与 getOverview 一致
export type RegionStatRow = {
  /** 用于界面展示:district+town 拼接,district 缺失时回退到 town */
  region: string;
  /** 标量字段供下钻到客户列表 */
  district: string | null;
  town: string | null;
  customerCount: number;
  contractCount: number;
  contractAmount: number;
  invoiceAmount: number;
  paymentAmount: number;
  invoiceRate: number;
  paymentRate: number;
  unpaidAmount: number;
};

export async function getRegionStatistics(user: SessionUser, range?: DateRange): Promise<RegionStatRow[]> {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const customerWhere = { deletedAt: null, ...ownerEq(user) } as Prisma.CustomerWhereInput;
  const signWhere = {
    deletedAt: null,
    status: { in: ["ACTIVE", "CLOSED"] },
    ...(range ? { signDate: dateWhere(range) } : {}),
    ...ownerEq(user)
  } as Prisma.ContractWhereInput;
  const invoiceWhere = {
    deletedAt: null,
    status: "ISSUED",
    ...(range ? { actualIssueDate: dateWhere(range, "actualIssueDate") } : {}),
    ...(ownerViaContract(user) as Prisma.InvoiceWhereInput)
  };
  const paymentWhere = {
    deletedAt: null,
    status: { in: ["CONFIRMED", "RECONCILED"] },
    ...(range ? { receivedAt: dateWhere(range, "receivedAt") } : {}),
    ...(ownerViaContract(user) as Prisma.PaymentWhereInput)
  };

  const [customers, contractRows, invoiceRows, paymentRows] = await Promise.all([
    prisma.customer.findMany({ where: customerWhere, select: { id: true, district: true, town: true } }),
    prisma.contract.groupBy({
      by: ["customerId"],
      where: signWhere,
      _sum: { totalAmount: true },
      _count: { _all: true }
    }),
    prisma.invoice.groupBy({ by: ["customerId"], where: invoiceWhere, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ["customerId"], where: paymentWhere, _sum: { amount: true } })
  ]);

  const regionOf = new Map<string, { district: string | null; town: string | null }>();
  for (const c of customers) regionOf.set(c.id, { district: c.district, town: c.town });

  type Bucket = {
    district: string | null;
    town: string | null;
    customers: Set<string>;
    contractCount: number;
    contractAmount: number;
    invoiceAmount: number;
    paymentAmount: number;
  };
  // 按 district+town 双字段分桶,避免跨区同名镇街被合并到一行
  const buckets = new Map<string, Bucket>();
  const keyOf = (district: string | null, town: string | null) => `${district ?? ""}|${town ?? ""}`;
  const getOrCreate = (district: string | null, town: string | null): Bucket => {
    const key = keyOf(district, town);
    let b = buckets.get(key);
    if (!b) {
      b = { district, town, customers: new Set(), contractCount: 0, contractAmount: 0, invoiceAmount: 0, paymentAmount: 0 };
      buckets.set(key, b);
    }
    return b;
  };

  for (const r of contractRows) {
    const reg = regionOf.get(r.customerId);
    if (!reg) continue;
    const b = getOrCreate(reg.district, reg.town);
    b.contractCount += r._count._all;
    b.contractAmount += Number(r._sum.totalAmount ?? 0);
    b.customers.add(r.customerId);
  }
  for (const r of invoiceRows) {
    const reg = regionOf.get(r.customerId);
    if (!reg) continue;
    const b = getOrCreate(reg.district, reg.town);
    b.invoiceAmount += Number(r._sum.amount ?? 0);
    b.customers.add(r.customerId);
  }
  for (const r of paymentRows) {
    const reg = regionOf.get(r.customerId);
    if (!reg) continue;
    const b = getOrCreate(reg.district, reg.town);
    b.paymentAmount += Number(r._sum.amount ?? 0);
    b.customers.add(r.customerId);
  }

  const rows: RegionStatRow[] = Array.from(buckets.values()).map((b) => {
    const contract = round2(b.contractAmount);
    const invoice = round2(b.invoiceAmount);
    const payment = round2(b.paymentAmount);
    const unpaid = round2(Math.max(0, invoice - payment));
    // 显示名:都填 -> "区 镇街";只填 town -> "镇街";只填 district -> "区(未填镇街)";都没 -> "未填写"
    const region =
      b.district && b.town ? `${b.district} ${b.town}` :
      b.town ? b.town :
      b.district ? `${b.district} (未填镇街)` :
      "未填写";
    return {
      region,
      district: b.district,
      town: b.town,
      customerCount: b.customers.size,
      contractCount: b.contractCount,
      contractAmount: contract,
      invoiceAmount: invoice,
      paymentAmount: payment,
      invoiceRate: contract > 0 ? round2((invoice / contract) * 100) : 0,
      paymentRate: invoice > 0 ? round2((payment / invoice) * 100) : 0,
      unpaidAmount: unpaid
    };
  });
  // district+town 都为空的"未填写"行排最末, 其余按合同额降序
  rows.sort((a, b) => {
    const aUnfilled = !a.district && !a.town;
    const bUnfilled = !b.district && !b.town;
    if (aUnfilled && !bUnfilled) return 1;
    if (!aUnfilled && bUnfilled) return -1;
    return b.contractAmount - a.contractAmount;
  });
  return rows;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
