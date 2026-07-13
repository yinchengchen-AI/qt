// 统计服务：合同/开票/回款汇总 + 账龄 + Top10 + 业务人员业绩
import { prisma } from "@/lib/prisma";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { Prisma } from "@prisma/client";
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
  const signWhere = { ...where, status: { in: ["ACTIVE", "CLOSED"] }, isLegacyZeroAmount: false, signDate: dateWhere(range) };
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
  const contractAmount = new Prisma.Decimal(contractAgg._sum.totalAmount ?? 0);
  const invoiceAmount = new Prisma.Decimal(invoiceAgg._sum.amount ?? 0);
  const paymentAmount = new Prisma.Decimal(paymentAgg._sum.amount ?? 0);
  // 未回款 = 已开票 - 已回款。paymentAmount 包含未挂账到发票的预付款,
  // 可能大于 invoiceAmount(此时算出的"未回款"为负),clamp 到 0 防止出现 -¥X
  const unpaidRaw = invoiceAmount.minus(paymentAmount);
  return {
    contractAmount: round2(contractAmount),
    invoiceAmount: round2(invoiceAmount),
    paymentAmount: round2(paymentAmount),
    unpaidAmount: round2(unpaidRaw.greaterThan(0) ? unpaidRaw : 0),
    invoiceRate: contractAmount.greaterThan(0) ? round2(invoiceAmount.div(contractAmount).mul(100)) : 0,
    paymentRate: invoiceAmount.greaterThan(0) ? round2(paymentAmount.div(invoiceAmount).mul(100)) : 0,
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
        isLegacyZeroAmount: false,
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

  const buckets = new Map<string, { contract: Prisma.Decimal; invoice: Prisma.Decimal; payment: Prisma.Decimal }>();
  for (const m of months) buckets.set(m, { contract: new Prisma.Decimal(0), invoice: new Prisma.Decimal(0), payment: new Prisma.Decimal(0) });

  for (const c of contracts) {
    const d = new Date(c.signDate);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(k);
    if (b) b.contract = b.contract.plus(c.totalAmount);
  }
  for (const i of invoices) {
    if (!i.actualIssueDate) continue;
    const d = new Date(i.actualIssueDate);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(k);
    if (b) b.invoice = b.invoice.plus(i.amount);
  }
  for (const p of payments) {
    const d = new Date(p.receivedAt);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const b = buckets.get(k);
    if (b) b.payment = b.payment.plus(p.amount);
  }

  return months.map((m) => ({
    month: m,
    contractAmount: round2(buckets.get(m)!.contract),
    invoiceAmount: round2(buckets.get(m)!.invoice),
    paymentAmount: round2(buckets.get(m)!.payment),
  }));
}

// 3. 应收账款账龄
// 返回: { buckets, total, rows, summary, byCustomer, byOwner, pagination }
//   - buckets: 4 桶(0-30 / 31-60 / 61-90 / 90+)金额合计,供 dashboard / 老接口
//   - total: 全部超期发票数(可能 > pagination.total,因为分页被截)
//   - rows: 当前页的发票列表(默认 page=1 pageSize=20)
//   - summary: KPI 汇总(应收总额 / 90+ 余额 / 最高单笔 / 涉及客户数 / 涉及业务人员数)
//   - byCustomer / byOwner: 客户 / 业务人员 维度的桶分布 Top 20
//   - pagination: { page, pageSize, total, totalPages }
// 旧字段(buckets/total/rows)保持不变以保证 dashboard 兼容;rows 截到 pageSize,
// 老接口默认 pageSize=100 还原"全量"行为(避免老 dashboard 拿到 20 条)。
export type AgingQuery = {
  basis?: "issue" | "due";
  customerId?: string;
  ownerUserId?: string;
  contractId?: string;
  buckets?: string[]; // 过滤:只保留这些桶
  minAmount?: number; // 过滤:剩余未收 >= minAmount
  page?: number;
  pageSize?: number;
  sort?: "daysOverdue:desc" | "amount:desc" | "customerName:asc";
  // 报表中心:按发票开具/到期日期范围过滤
  from?: Date;
  to?: Date;
};

export type AgingRow = {
  invoiceId: string;
  invoiceNo: string;
  customerId: string;
  customerName: string;
  contractId: string;
  contractNo: string | null;
  ownerUserId: string;
  ownerName: string;
  daysOverdue: number;
  remaining: number;
  bucket: "0-30" | "31-60" | "61-90" | "90+";
  status: string;
  basisUsed: "issue" | "due";
  hasDunning: boolean;
  latestDunningStatus: string | null;
  latestDunningAt: string | null;
};

export type AgingDimensionRow = {
  key: string;
  name: string;
  code: string | null;
  totalReceivable: number;
  bucket0_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket90: number;
  over90Ratio: number;
  invoiceCount: number;
};

export type AgingSummary = {
  totalReceivable: number;
  over90Amount: number;
  over90Ratio: number;
  largestInvoice: { invoiceId: string; invoiceNo: string; remaining: number } | null;
  customerCount: number;
  ownerCount: number;
};

export type AgingResult = {
  buckets: { "0-30": number; "31-60": number; "61-90": number; "90+": number };
  total: number;
  rows: AgingRow[];
  summary: AgingSummary;
  byCustomer: AgingDimensionRow[];
  byOwner: AgingDimensionRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  basisUsed: "issue" | "due";
};

const _BUCKET_KEYS = ["0-30", "31-60", "61-90", "90+"] as const;
type BucketKey = (typeof _BUCKET_KEYS)[number];
type Bucket = BucketKey;

function bucketOf(days: number): Bucket {
  // 与现状保持一致:负数(数据错录)归 90+ 段,被视为最高风险
  if (days < 0) return "90+";
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export async function getInvoiceAging(
  user: SessionUser,
  query: AgingQuery = {}
): Promise<AgingResult> {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const basis = query.basis ?? "due";
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 100));
  const sort = query.sort ?? "daysOverdue:desc";

  const now = new Date();

  // 1) 拉基础发票池(应用 owner 隔离 + 业务过滤)
  const baseWhere: Prisma.InvoiceWhereInput = {
    deletedAt: null,
    status: "ISSUED",
    ...(ownerViaContract(user) as Prisma.InvoiceWhereInput)
  };
  if (query.customerId) baseWhere.customerId = query.customerId;
  if (query.contractId) baseWhere.contractId = query.contractId;
  if (query.ownerUserId) {
    const existing = (baseWhere.contract ?? {}) as Prisma.ContractWhereInput;
    baseWhere.contract = { ...existing, ownerUserId: query.ownerUserId } as Prisma.InvoiceWhereInput['contract'];
  }
  // 报表中心:按日期范围过滤发票开具/到期日
  if (query.from || query.to) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (query.from) dateFilter.gte = query.from;
    if (query.to) dateFilter.lte = query.to;
    if (basis === "issue") {
      baseWhere.actualIssueDate = dateFilter;
    } else {
      baseWhere.dueDate = dateFilter;
    }
  }

  const invoices = await prisma.invoice.findMany({
    where: baseWhere,
    select: {
      id: true,
      invoiceNo: true,
      amount: true,
      actualIssueDate: true,
      dueDate: true,
      customerId: true,
      customerName: true,
      contractId: true,
      status: true,
      contract: { select: { ownerUserId: true, owner: { select: { name: true } } } }
    }
  });
  // 拉合同号(owner 显示需要)
  const contractIds = [...new Set(invoices.map((i) => i.contractId))];
  const contracts = contractIds.length > 0
    ? await prisma.contract.findMany({
        where: { id: { in: contractIds } },
        select: { id: true, contractNo: true }
      })
    : [];
  const contractNoMap = new Map(contracts.map((c) => [c.id, c.contractNo]));

  // 2) 拉每张发票的"仍生效"回款
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

  // 3) 拉每张发票的"最新 1 条"催收记录 — 用 groupBy 拿 max(lastContactAt),
  //   再用 in + 排序取该 max 对应那条的 status. 比 findMany 拉全表省内存.
  //   注意: 多条催收同 lastContactAt 时 groupBy 拿不到 status, 走 fallback 二次查询
  //   限定 invoiceId + lastContactAt 来精确锁定.
  const latestDunningMax = await prisma.dunningNote.groupBy({
    by: ["invoiceId"],
    where: { invoiceId: { in: invoices.map((i) => i.id) } },
    _max: { lastContactAt: true }
  });
  const latestDunningMap = new Map<string, { status: string; lastContactAt: Date }>();
  if (latestDunningMax.length > 0) {
    // 用 max 时间作为锚, 二次查询拿对应的 status
    const anchorRows = await prisma.dunningNote.findMany({
      where: {
        invoiceId: { in: latestDunningMax.map((m) => m.invoiceId) },
        lastContactAt: { in: latestDunningMax.map((m) => m._max.lastContactAt).filter((d): d is Date => d !== null) }
      },
      select: { invoiceId: true, status: true, lastContactAt: true }
    });
    for (const d of anchorRows) {
      if (!latestDunningMap.has(d.invoiceId)) {
        latestDunningMap.set(d.invoiceId, { status: d.status, lastContactAt: d.lastContactAt });
      }
    }
  }

  // 4) 计算每张发票的 daysOverdue / remaining / bucket
  const allRows: AgingRow[] = [];
  for (const inv of invoices) {
    // 基准日:basis=issue 用 actualIssueDate;basis=due 用 dueDate,fallback 到 actualIssueDate
    const basisDate =
      basis === "issue"
        ? inv.actualIssueDate
        : (inv.dueDate ?? inv.actualIssueDate);
    if (!basisDate) continue; // 都没值,跳过
    const days = daysBetween(now, new Date(basisDate));
    const remain = new Prisma.Decimal(inv.amount).minus(paidMap.get(inv.id) ?? 0);
    if (remain.lessThanOrEqualTo(0.01)) continue; // 0.01 容差
    const bucket = bucketOf(days);
    allRows.push({
      invoiceId: inv.id,
      invoiceNo: inv.invoiceNo,
      customerId: inv.customerId,
      customerName: inv.customerName,
      contractId: inv.contractId,
      contractNo: contractNoMap.get(inv.contractId) ?? null,
      ownerUserId: inv.contract?.ownerUserId ?? "",
      ownerName: inv.contract?.owner?.name ?? "-",
      daysOverdue: days,
      remaining: round2(remain),
      bucket,
      status: inv.status,
      basisUsed: basis,
      hasDunning: latestDunningMap.has(inv.id),
      latestDunningStatus: latestDunningMap.get(inv.id)?.status ?? null,
      latestDunningAt: latestDunningMap.get(inv.id)?.lastContactAt.toISOString() ?? null
    });
  }

  // 5) 应用桶过滤 + 最小金额过滤
  const bucketsFilter = query.buckets && query.buckets.length > 0 ? new Set(query.buckets as Bucket[]) : null;
  const minAmount = typeof query.minAmount === "number" && query.minAmount > 0 ? query.minAmount : 0;
  const filtered = allRows.filter((r) => {
    if (bucketsFilter && !bucketsFilter.has(r.bucket)) return false;
    if (r.remaining < minAmount) return false;
    return true;
  });

  // 6) 排序
  filtered.sort((a, b) => {
    if (sort === "amount:desc") return b.remaining - a.remaining || b.daysOverdue - a.daysOverdue;
    if (sort === "customerName:asc") return a.customerName.localeCompare(b.customerName, "zh-CN");
    return b.daysOverdue - a.daysOverdue;
  });

  // 7) 分桶汇总(对全量 filtered,不是仅当前页 — KPI 反映全部超期)
  const buckets = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 } as Record<Bucket, number>;
  for (const r of filtered) buckets[r.bucket] = round2(buckets[r.bucket] + r.remaining);

  // 8) 维度聚合(byCustomer / byOwner)
  const byCustomer = aggregateByDimension(filtered, "customerId", "customerName");
  const byOwner = aggregateByDimension(filtered, "ownerUserId", "ownerName");

  // 9) Summary
  const totalReceivable = round2(filtered.reduce((s, r) => s + r.remaining, 0));
  const over90Amount = round2(buckets["90+"]);
  const over90Ratio = totalReceivable > 0 ? round2((over90Amount / totalReceivable) * 100) : 0;
  const largest = filtered.length > 0 ? filtered.reduce((a, b) => (b.remaining > a.remaining ? b : a)) : null;
  const customerCount = new Set(filtered.map((r) => r.customerId)).size;
  const ownerCount = new Set(filtered.map((r) => r.ownerUserId).filter(Boolean)).size;

  // 10) 分页
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return {
    buckets: buckets as AgingResult["buckets"],
    total, // 老字段:全量超期数
    rows: pageRows, // 老字段:当前页(分页后)
    summary: {
      totalReceivable,
      over90Amount,
      over90Ratio,
      largestInvoice: largest
        ? { invoiceId: largest.invoiceId, invoiceNo: largest.invoiceNo, remaining: largest.remaining }
        : null,
      customerCount,
      ownerCount
    },
    byCustomer,
    byOwner,
    pagination: { page, pageSize, total, totalPages },
    basisUsed: basis
  };
}

function aggregateByDimension(
  rows: AgingRow[],
  idKey: "customerId" | "ownerUserId",
  nameKey: "customerName" | "ownerName"
): AgingDimensionRow[] {
  const map = new Map<string, AgingDimensionRow>();
  for (const r of rows) {
    const id = r[idKey];
    if (!id) continue;
    const existing = map.get(id);
    if (existing) {
      existing.totalReceivable = round2(existing.totalReceivable + r.remaining);
      if (r.bucket === "0-30") existing.bucket0_30 = round2(existing.bucket0_30 + r.remaining);
      else if (r.bucket === "31-60") existing.bucket31_60 = round2(existing.bucket31_60 + r.remaining);
      else if (r.bucket === "61-90") existing.bucket61_90 = round2(existing.bucket61_90 + r.remaining);
      else if (r.bucket === "90+") existing.bucket90 = round2(existing.bucket90 + r.remaining);
      existing.invoiceCount += 1;
    } else {
      map.set(id, {
        key: id,
        name: r[nameKey],
        code: null,
        totalReceivable: round2(r.remaining),
        bucket0_30: r.bucket === "0-30" ? round2(r.remaining) : 0,
        bucket31_60: r.bucket === "31-60" ? round2(r.remaining) : 0,
        bucket61_90: r.bucket === "61-90" ? round2(r.remaining) : 0,
        bucket90: r.bucket === "90+" ? round2(r.remaining) : 0,
        over90Ratio: 0,
        invoiceCount: 1
      });
    }
  }
  const list = Array.from(map.values());
  for (const x of list) {
    x.over90Ratio = x.totalReceivable > 0 ? round2((x.bucket90 / x.totalReceivable) * 100) : 0;
  }
  list.sort((a, b) => b.totalReceivable - a.totalReceivable);
  return list;
}

// 3.1 客户 / 业务人员 维度的 Top N(独立接口,不限 pageSize)
// 直接走 prisma groupBy 拿全量聚合,避免依赖 getInvoiceAging 的 pageSize 截断.
// bucket 分段在 JS 端按 (today - basisDate) 算 days 然后 bucketOf().
// 同一笔 invoice 在不同 basis 下可能落到不同桶, 但 amount / paid 不变, 所以聚合逻辑稳定.
async function getAgingByDimensionGrouped(
  user: SessionUser,
  basis: "issue" | "due",
  dim: "customer" | "owner"
): Promise<AgingDimensionRow[]> {
  // 1) 拉所有 ISSUED 发票的基础数据 (amount, basis date, customerId/ownerUserId, customerName/ownerName)
  const baseWhere: Prisma.InvoiceWhereInput = {
    deletedAt: null,
    status: "ISSUED",
    ...(ownerViaContract(user) as Prisma.InvoiceWhereInput)
  };
  const invoices = await prisma.invoice.findMany({
    where: baseWhere,
    select: {
      id: true,
      amount: true,
      actualIssueDate: true,
      dueDate: true,
      customerId: true,
      customerName: true,
      contract: { select: { ownerUserId: true, owner: { select: { name: true } } } }
    }
  });
  if (invoices.length === 0) return [];
  // 2) 一次 groupBy 拿所有"仍生效回款"
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
  // 3) 在内存里算 days/remaining/bucket, 然后按 dim key 聚合
  const now = new Date();
  const agg = new Map<string, AgingDimensionRow>();
  for (const inv of invoices) {
    const basisDate = basis === "issue" ? inv.actualIssueDate : inv.dueDate ?? inv.actualIssueDate;
    if (!basisDate) continue;
    const remain = new Prisma.Decimal(inv.amount).minus(paidMap.get(inv.id) ?? 0);
    if (remain.lessThanOrEqualTo(0.01)) continue;
    const days = daysBetween(now, new Date(basisDate));
    const bucket = bucketOf(days);
    const key = dim === "customer" ? inv.customerId : (inv.contract?.ownerUserId ?? "");
    if (!key) continue;
    const name = dim === "customer" ? inv.customerName : (inv.contract?.owner?.name ?? "-");
    const existing = agg.get(key);
    if (existing) {
      existing.totalReceivable = round2(new Prisma.Decimal(existing.totalReceivable).plus(remain));
      if (bucket === "0-30") existing.bucket0_30 = round2(new Prisma.Decimal(existing.bucket0_30).plus(remain));
      else if (bucket === "31-60") existing.bucket31_60 = round2(new Prisma.Decimal(existing.bucket31_60).plus(remain));
      else if (bucket === "61-90") existing.bucket61_90 = round2(new Prisma.Decimal(existing.bucket61_90).plus(remain));
      else if (bucket === "90+") existing.bucket90 = round2(new Prisma.Decimal(existing.bucket90).plus(remain));
      existing.invoiceCount += 1;
    } else {
      agg.set(key, {
        key,
        name,
        code: null,
        totalReceivable: round2(remain),
        bucket0_30: bucket === "0-30" ? round2(remain) : 0,
        bucket31_60: bucket === "31-60" ? round2(remain) : 0,
        bucket61_90: bucket === "61-90" ? round2(remain) : 0,
        bucket90: bucket === "90+" ? round2(remain) : 0,
        over90Ratio: 0,
        invoiceCount: 1
      });
    }
  }
  const list = Array.from(agg.values());
  for (const x of list) {
    x.over90Ratio = x.totalReceivable > 0 ? round2((x.bucket90 / x.totalReceivable) * 100) : 0;
  }
  list.sort((a, b) => b.totalReceivable - a.totalReceivable);
  return list;
}

export async function getAgingByCustomer(
  user: SessionUser,
  query: { basis?: "issue" | "due"; limit?: number; minAmount?: number } = {}
) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const basis = query.basis ?? "due";
  let list = await getAgingByDimensionGrouped(user, basis, "customer");
  if (typeof query.minAmount === "number" && query.minAmount > 0) {
    list = list.filter((x) => x.totalReceivable >= query.minAmount!);
  }
  return list.slice(0, query.limit ?? 20);
}

export async function getAgingByOwner(
  user: SessionUser,
  query: { basis?: "issue" | "due"; limit?: number } = {}
) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const basis = query.basis ?? "due";
  const list = await getAgingByDimensionGrouped(user, basis, "owner");
  return list.slice(0, query.limit ?? 20);
}

// 3.2 未开票合同预警
// 筛 status=ACTIVE 且无 ISSUED Invoice 的合同,按 signDate 升序;
// daysSinceSign = today - signDate;thresholdDays 可由调用方指定,默认 30。
export type UninvoicedContractRow = {
  contractId: string;
  contractNo: string;
  customerId: string;
  customerName: string;
  signDate: string;
  totalAmount: number;
  daysSinceSign: number;
  ownerUserId: string;
  ownerName: string;
  isOverdue: boolean; // daysSinceSign > thresholdDays
};

export async function getUninvoicedContracts(
  user: SessionUser,
  query: { thresholdDays?: number; limit?: number } = {}
): Promise<UninvoicedContractRow[]> {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const thresholdDays = query.thresholdDays ?? 30;
  const limit = query.limit ?? 50;
  const now = new Date();

  // 拉全部 ACTIVE 合同(应用 owner 隔离)
  const contracts = await prisma.contract.findMany({
    where: {
      deletedAt: null,
      status: "ACTIVE",
      isLegacyZeroAmount: false,
      ...(ownerEq(user) as Prisma.ContractWhereInput)
    },
    select: {
      id: true,
      contractNo: true,
      customerId: true,
      customerName: true,
      signDate: true,
      totalAmount: true,
      ownerUserId: true,
      owner: { select: { name: true } }
    },
    orderBy: { signDate: "asc" }
  });
  if (contracts.length === 0) return [];

  // 一次性 groupBy by contractId 找出有 ISSUED 发票的合同
  const invoicedRows = await prisma.invoice.groupBy({
    by: ["contractId"],
    where: {
      deletedAt: null,
      status: "ISSUED",
      contractId: { in: contracts.map((c) => c.id) }
    },
    _count: { _all: true }
  });
  const invoicedSet = new Set(invoicedRows.filter((r) => r._count._all > 0).map((r) => r.contractId));

  const rows: UninvoicedContractRow[] = [];
  for (const c of contracts) {
    if (invoicedSet.has(c.id)) continue;
    const days = daysBetween(now, new Date(c.signDate));
    rows.push({
      contractId: c.id,
      contractNo: c.contractNo,
      customerId: c.customerId,
      customerName: c.customerName,
      signDate: c.signDate.toISOString(),
      totalAmount: round2(Number(c.totalAmount)),
      daysSinceSign: days,
      ownerUserId: c.ownerUserId,
      ownerName: c.owner?.name ?? "-",
      isOverdue: days > thresholdDays
    });
  }
  return rows.slice(0, limit);
}

// 3.3 账龄趋势(近 N 天,默认 30)
// 实现:把"现在"回退 N 天到 (now - N*day),遍历每日 asOf,调用 bucketOf(due - asOf)
//   给出该日"如果以这天为口径截止日"的桶分布。
// 注意:这是 in-memory 计算,N=30 时每次 ~30 次 getInvoiceAging 调用;数据量小时可行,
//   数据量起来后改写为 AgingSnapshot 定时表 (生产用 cron 写盘,API 读盘)。
export async function getAgingTrend(
  user: SessionUser,
  query: { days?: number; basis?: "issue" | "due" } = {}
) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const days = Math.min(180, Math.max(1, query.days ?? 30));
  const basis = query.basis ?? "due";
  const now = new Date();
  // 把 now 截到 UTC 0 点,避免漂移
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // 一次性拉取需要的发票 + 回款(避免 N 次 query);我们直接复用 getInvoiceAging
  //   在内存里模拟"as of 某日",性能边界见函数顶部注释。
  const out: Array<{ date: string; total: number; byBucket: Record<Bucket, number> }> = [];
  for (let i = days - 1; i >= 0; i--) {
    const asOf = new Date(todayUtc);
    asOf.setUTCDate(asOf.getUTCDate() - i);
    // 单日只算一次,O(N)=30 时 30 次 in-memory 重算,生产可换 AgingSnapshot。
    const r = await getInvoiceAgingForDate(user, basis, asOf);
    out.push({
      date: asOf.toISOString().slice(0, 10),
      total: round2(r.bucket0_30 + r.bucket31_60 + r.bucket61_90 + r.bucket90),
      byBucket: { "0-30": r.bucket0_30, "31-60": r.bucket31_60, "61-90": r.bucket61_90, "90+": r.bucket90 }
    });
  }
  return out;
}

type TrendBucket = { bucket0_30: number; bucket31_60: number; bucket61_90: number; bucket90: number };

function endOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

async function getInvoiceAgingForDate(
  user: SessionUser,
  basis: "issue" | "due",
  asOf: Date
): Promise<TrendBucket> {
  // 与 getInvoiceAging 主体同口径,只把"现在"换成 asOf
  const baseWhere: Prisma.InvoiceWhereInput = {
    deletedAt: null,
    status: "ISSUED",
    ...(ownerViaContract(user) as Prisma.InvoiceWhereInput)
  };
  const invoices = await prisma.invoice.findMany({
    where: baseWhere,
    select: { id: true, amount: true, actualIssueDate: true, dueDate: true }
  });
  if (invoices.length === 0) {
    return { bucket0_30: 0, bucket31_60: 0, bucket61_90: 0, bucket90: 0 };
  }
  const paid = await prisma.payment.groupBy({
    by: ["invoiceId"],
    where: {
      invoiceId: { in: invoices.map((i) => i.id) },
      status: { in: ["CONFIRMED", "RECONCILED"] },
      // asOf 当日 23:59:59 之前已到账的回款都算"已到账" — 避免 UTC 0 点切分
      // 把当天已发生但晚于 0 点的回款漏掉,导致趋势在边界日跳变.
      receivedAt: { lte: endOfDayUtc(asOf) },
      deletedAt: null
    },
    _sum: { amount: true }
  });
  const paidMap = new Map<string, number>();
  for (const p of paid) paidMap.set(p.invoiceId!, Number(p._sum.amount ?? 0));

  const out = { bucket0_30: 0, bucket31_60: 0, bucket61_90: 0, bucket90: 0 } as TrendBucket;
  for (const inv of invoices) {
    const basisDate = basis === "issue" ? inv.actualIssueDate : inv.dueDate ?? inv.actualIssueDate;
    if (!basisDate) continue;
    // asOf 必须 >= basisDate 才算"已超期"
    if (asOf.getTime() < new Date(basisDate).getTime()) continue;
    const days = daysBetween(asOf, new Date(basisDate));
    const remain = new Prisma.Decimal(inv.amount).minus(paidMap.get(inv.id) ?? 0);
    if (remain.lessThanOrEqualTo(0.01)) continue;
    const b = bucketOf(days);
    if (b === "0-30") out.bucket0_30 = round2(new Prisma.Decimal(out.bucket0_30).plus(remain));
    else if (b === "31-60") out.bucket31_60 = round2(new Prisma.Decimal(out.bucket31_60).plus(remain));
    else if (b === "61-90") out.bucket61_90 = round2(new Prisma.Decimal(out.bucket61_90).plus(remain));
    else out.bucket90 = round2(new Prisma.Decimal(out.bucket90).plus(remain));
  }
  return out;
}

// 4. Top 客户（按合同额 / 回款额）
// 实现:用 groupBy by customerId 一次拿全部客户的合同/开票/回款汇总,
// 把 1 + N×4 的 N+1 拍平为常数次(4)查询。
// range 可选:不传则全量,传则按 signDate / actualIssueDate / receivedAt 同时过滤。
export async function getTopCustomers(user: SessionUser, metric: "contract" | "payment" = "contract", limit = 10, range?: DateRange) {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  const signWhere = { deletedAt: null, status: { in: ["ACTIVE", "CLOSED"] }, isLegacyZeroAmount: false, ...(range ? { signDate: dateWhere(range) } : {}), ...ownerEq(user) };
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
    isLegacyZeroAmount: false,
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

  const sumByOwner = new Map<string, { invoice: Prisma.Decimal; payment: Prisma.Decimal }>();
  for (const r of invoiceRows) {
    const owner = contractOwnerMap.get(r.contractId);
    if (!owner) continue;
    const cur = sumByOwner.get(owner) ?? { invoice: new Prisma.Decimal(0), payment: new Prisma.Decimal(0) };
    cur.invoice = cur.invoice.plus(r._sum.amount ?? 0);
    sumByOwner.set(owner, cur);
  }
  for (const r of paymentRows) {
    const owner = contractOwnerMap.get(r.contractId);
    if (!owner) continue;
    const cur = sumByOwner.get(owner) ?? { invoice: new Prisma.Decimal(0), payment: new Prisma.Decimal(0) };
    cur.payment = cur.payment.plus(r._sum.amount ?? 0);
    sumByOwner.set(owner, cur);
  }

  const out: PerformanceRow[] = owners.map((u) => {
    const cr = contractRows.find((r) => r.ownerUserId === u.id);
    const ip = sumByOwner.get(u.id) ?? { invoice: 0, payment: 0 };
    return {
      userId: u.id,
      name: u.name,
      employeeNo: u.employeeNo,
      contractAmount: round2(new Prisma.Decimal(cr?._sum.totalAmount ?? 0)),
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


// 5.1 签约明细（按签约人汇总的合同级明细）
// 用途:员工业绩报表详情页 / 报表中心 PERFORMANCE 报告的"签约明细"小节。
// 字段对应 2026年5月业务明细.pdf 模板:
//   所属区域 | 企业名称 | 服务项目 | 签约人 | 合同金额
// - 按签约人 (signerId) 分组,组内按 signDate 升序排序
// - 每组末尾追加 subtotalWan (万元, 保留 2 位小数) 行,便于 Excel 透视
// - SALES 角色:只能看自己签约的合同
// - range 同时过滤 signDate;signDate 为 null 的合同排除
// - 单租户默认无 MAX_ROWS 限制(业务报表需要全量明细),由调用方按需兜底
export type SignerDetailRow = {
  contractId: string;
  contractNo: string;
  district: string | null;       // 区 (e.g. "余杭区")
  town: string | null;           // 镇街 (e.g. "塘栖镇")
  /** 展示用 "区 镇街" / 仅镇街 / 仅区 / "未填写" */
  region: string;
  customerId: string;
  customerName: string;
  serviceType: string;           // 原始 code
  serviceTypeLabel: string;      // 中文 label
  signerId: string;
  signerName: string;
  signerEmployeeNo: string;
  signDate: string;              // ISO
  totalAmount: number;
};

export type SignerDetailGroup = {
  signerId: string;
  signerName: string;
  signerEmployeeNo: string;
  rows: SignerDetailRow[];
  /** 该签约人合同总额 (元) */
  contractAmount: number;
  /** 万元, 保留 2 位小数 (用于表格右侧小计列) */
  subtotalWan: number;
};

export async function getSignerContractDetail(
  user: SessionUser,
  range?: DateRange
): Promise<SignerDetailGroup[]> {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  // 合同查询条件:deletedAt/状态/range + 行级隔离
  // SALES 角色:行级隔离要求 owner/signer 至少匹配一个(因业务上 SALES 既是
  // 业务人员 [owner] 也可能作为签约人 [signer] 出现, 单一维度会漏);其它角色
  // 走 ownerEq 走 ownerUserId 过滤即可。
  const isSales = user.roleCode === "SALES";
  const where: Prisma.ContractWhereInput = {
    deletedAt: null,
    status: { in: ["ACTIVE", "CLOSED"] },
    ...(range ? { signDate: dateWhere(range) } : {}),
    ...(isSales ? { OR: [{ ownerUserId: user.id }, { signerId: user.id }] } : ownerEq(user)),
  };

  const contracts = await prisma.contract.findMany({
    where,
    select: {
      id: true,
      contractNo: true,
      customerId: true,
      customer: { select: { name: true, district: true, town: true } },
      serviceType: true,
      signerId: true,
      signDate: true,
      totalAmount: true,
      signer: { select: { id: true, name: true, employeeNo: true } }
    },
    orderBy: [{ signerId: "asc" }, { signDate: "asc" }]
  });

  if (contracts.length === 0) return [];

  // 一次性查 serviceType -> 中文 label (内存映射,免 N+1)
  // 优先 Dictionary(category=SERVICE_TYPE) 实时拉,fallback 到 SERVICE_TYPE_MAP 静态表
  const dictRows = await prisma.dictionary.findMany({
    where: { category: "SERVICE_TYPE", isActive: true },
    select: { code: true, label: true }
  });
  const dictMap = new Map(dictRows.map((d) => [d.code, d.label]));

  // 按签约人分组
  const groups = new Map<string, SignerDetailGroup>();
  for (const c of contracts) {
    const signer = c.signer;
    if (!signer) continue; // 签约人被软删/缺失,跳过
    let g = groups.get(signer.id);
    if (!g) {
      g = {
        signerId: signer.id,
        signerName: signer.name,
        signerEmployeeNo: signer.employeeNo,
        rows: [],
        contractAmount: 0,
        subtotalWan: 0
      };
      groups.set(signer.id, g);
    }
    const district = c.customer?.district ?? null;
    const town = c.customer?.town ?? null;
    const region =
      district && town ? `${district} ${town}` :
      town ? town :
      district ? `${district} (未填镇街)` :
      "未填写";
    const amount = round2(c.totalAmount);
    const svcCode = c.serviceType;
    const svcLabel = dictMap.get(svcCode) ?? svcCode;
    g.rows.push({
      contractId: c.id,
      contractNo: c.contractNo,
      district,
      town,
      region,
      customerId: c.customerId,
      customerName: c.customer?.name ?? "",
      serviceType: svcCode,
      serviceTypeLabel: svcLabel,
      signerId: signer.id,
      signerName: signer.name,
      signerEmployeeNo: signer.employeeNo,
      signDate: c.signDate.toISOString(),
      totalAmount: amount
    });
    g.contractAmount = round2(new Prisma.Decimal(g.contractAmount).plus(amount));
  }

  // 排序:签约人按 employeeNo 升序(对齐 PDF 手填习惯),同组内按 signDate 已在 SQL 排好
  const out = Array.from(groups.values()).map((g) => ({
    ...g,
    subtotalWan: round2(g.contractAmount / 10_000)
  }));
  out.sort((a, b) => a.signerEmployeeNo.localeCompare(b.signerEmployeeNo, "zh-CN"));
  return out;
}

/**
 * 5.2 签约人业绩汇总（与签约明细同口径，按签约人聚合）
 *
 * 用途：员工业绩报表的"员工业绩汇总"区块。
 * 与 getEmployeePerformance 的区别：
 *   - getEmployeePerformance: 按 ownerUserId（负责人/业务人员）聚合
 *   - getSignerSummary:       按 signerId（签约人）聚合 — 跟签约明细同维度，
 *     同一张报表里"汇总"和"明细"是同一个人，逻辑自洽。
 *
 * 字段：签约人/工号/合同数/合同额/已开票额/已回款额，与原 getEmployeePerformance 同结构。
 * SALES 角色：只看自己作为签约人的合同。
 */
export type SignerSummaryRow = {
  userId: string;        // 签约人 userId（兼容原 aggregatePerformance 字段名）
  name: string;
  employeeNo: string;
  contractCount: number;
  contractAmount: number;
  invoiceAmount: number;
  paymentAmount: number;
};

export async function getSignerSummary(
  user: SessionUser,
  range?: DateRange
): Promise<SignerSummaryRow[]> {
  requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
  // 拉该 range 内所有 ACTIVE/CLOSED 合同，按 signerId 聚合
  const isSales = user.roleCode === "SALES";
  const contractWhere: Prisma.ContractWhereInput = {
    deletedAt: null,
    status: { in: ["ACTIVE", "CLOSED"] },
    ...(range ? { signDate: dateWhere(range) } : {}),
    ...(isSales
      ? { OR: [{ ownerUserId: user.id }, { signerId: user.id }] }
      : ownerEq(user)),
  };
  const contracts = await prisma.contract.findMany({
    where: contractWhere,
    select: {
      id: true,
      ownerUserId: true,
      signerId: true,
      totalAmount: true,
    },
  });
  if (contracts.length === 0) return [];
  // 拉 ISSUED invoice / CONFIRMED+RECONCILED payment, 按 contractId 聚合
  const contractIds = contracts.map((c) => c.id);
  const invoiceWhere: Prisma.InvoiceWhereInput = {
    deletedAt: null,
    status: "ISSUED",
    contractId: { in: contractIds },
    ...(range ? { actualIssueDate: dateWhere(range, "actualIssueDate") } : {}),
  };
  const paymentWhere: Prisma.PaymentWhereInput = {
    deletedAt: null,
    status: { in: ["CONFIRMED", "RECONCILED"] },
    contractId: { in: contractIds },
    ...(range ? { receivedAt: dateWhere(range, "receivedAt") } : {}),
  };
  const [invoiceRows, paymentRows, signers] = await Promise.all([
    prisma.invoice.groupBy({ by: ["contractId"], where: invoiceWhere, _sum: { amount: true } }),
    prisma.payment.groupBy({ by: ["contractId"], where: paymentWhere, _sum: { amount: true } }),
    prisma.user.findMany({
      where: { id: { in: [...new Set(contracts.map((c) => c.signerId))] } },
      select: { id: true, name: true, employeeNo: true },
    }),
  ]);
  const invoiceByContract = new Map(invoiceRows.map((r) => [r.contractId, Number(r._sum.amount ?? 0)]));
  const paymentByContract = new Map(paymentRows.map((r) => [r.contractId, Number(r._sum.amount ?? 0)]));
  const signerMap = new Map(signers.map((s) => [s.id, s]));

  // 按 signerId 累加
  const out = new Map<string, SignerSummaryRow>();
  for (const c of contracts) {
    const signer = signerMap.get(c.signerId);
    if (!signer) continue;
    let row = out.get(signer.id);
    if (!row) {
      row = {
        userId: signer.id,
        name: signer.name,
        employeeNo: signer.employeeNo,
        contractCount: 0,
        contractAmount: 0,
        invoiceAmount: 0,
        paymentAmount: 0,
      };
      out.set(signer.id, row);
    }
    row.contractCount += 1;
    row.contractAmount = round2(new Prisma.Decimal(row.contractAmount).plus(c.totalAmount));
    row.invoiceAmount = round2(new Prisma.Decimal(row.invoiceAmount).plus(invoiceByContract.get(c.id) ?? 0));
    row.paymentAmount = round2(new Prisma.Decimal(row.paymentAmount).plus(paymentByContract.get(c.id) ?? 0));
  }
  return Array.from(out.values()).sort((a, b) => b.contractAmount - a.contractAmount);
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
    isLegacyZeroAmount: false,
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
    b.contractAmount = round2(new Prisma.Decimal(b.contractAmount).plus(r._sum.totalAmount ?? 0));
    b.customers.add(r.customerId);
  }
  for (const r of invoiceRows) {
    const reg = regionOf.get(r.customerId);
    if (!reg) continue;
    const b = getOrCreate(reg.district, reg.town);
    b.invoiceAmount = round2(new Prisma.Decimal(b.invoiceAmount).plus(r._sum.amount ?? 0));
    b.customers.add(r.customerId);
  }
  for (const r of paymentRows) {
    const reg = regionOf.get(r.customerId);
    if (!reg) continue;
    const b = getOrCreate(reg.district, reg.town);
    b.paymentAmount = round2(new Prisma.Decimal(b.paymentAmount).plus(r._sum.amount ?? 0));
    b.customers.add(r.customerId);
  }

  const rows: RegionStatRow[] = Array.from(buckets.values()).map((b) => {
    const contract = round2(b.contractAmount);
    const invoice = round2(b.invoiceAmount);
    const payment = round2(b.paymentAmount);
    const unpaid = round2(new Prisma.Decimal(invoice).minus(payment).greaterThan(0) ? new Prisma.Decimal(invoice).minus(payment) : 0);
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
      invoiceRate: contract > 0 ? round2(new Prisma.Decimal(invoice).div(contract).mul(100)) : 0,
      paymentRate: invoice > 0 ? round2(new Prisma.Decimal(payment).div(invoice).mul(100)) : 0,
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

function round2(v: number | Prisma.Decimal): number {
  return new Prisma.Decimal(v).toDecimalPlaces(2).toNumber();
}
