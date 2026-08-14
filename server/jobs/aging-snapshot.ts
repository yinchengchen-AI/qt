// 账龄日快照 job:每日幂等 upsert 近 N 天 (asOfDate, basis) 的全局账龄桶。
// 口径与 getInvoiceAgingForDate 的"全局版"一致:
//   - invoices: status=ISSUED, deletedAt=null (全局不限 owner)
//   - payments: CONFIRMED/RECONCILED, receivedAt <= endOfDay(asOf)
//   - remaining = invoice.amount - paid, > MONEY_TOLERANCE 才计入
// 被 runner.ts 的 runAllJobs 调度;失败抛错由 runner 的 Promise.allSettled 捕获。
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { MONEY_TOLERANCE } from "@/lib/money-tolerance";

export type AgingSnapshotResult = {
  upserted: number;
  days: number;
};

type Bucket = "0-30" | "31-60" | "61-90" | "90+";

export type AgingBucketTotals = Record<Bucket, number>;

function bucketOf(days: number): Bucket {
  if (days <= 30) return "0-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

function daysBetweenUtc(later: Date, earlier: Date): number {
  const a = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
  const b = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
  return Math.floor((a - b) / 86_400_000);
}

function endOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999));
}

function round2(v: Prisma.Decimal | number): number {
  return new Prisma.Decimal(v).toDecimalPlaces(2).toNumber();
}

/** 计算单个 asOf 日期的全局账龄桶,供 job 逐日写入 (与 getInvoiceAging 同口径, 不带 owner 过滤)。 */
async function computeSnapshotForDate(
  basis: "issue" | "due",
  asOf: Date
): Promise<{ buckets: AgingBucketTotals; totalReceivable: number; invoiceCount: number }> {
  const invoices = await prisma.invoice.findMany({
    where: { deletedAt: null, status: "ISSUED" },
    select: { id: true, amount: true, actualIssueDate: true, dueDate: true }
  });
  if (invoices.length === 0) {
    return { buckets: { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 }, totalReceivable: 0, invoiceCount: 0 };
  }
  const paid = await prisma.payment.groupBy({
    by: ["invoiceId"],
    where: {
      invoiceId: { in: invoices.map((i) => i.id) },
      status: { in: ["CONFIRMED", "RECONCILED"] },
      receivedAt: { lte: endOfDayUtc(asOf) },
      deletedAt: null
    },
    _sum: { amount: true }
  });
  const paidMap = new Map<string, number>();
  for (const p of paid) paidMap.set(p.invoiceId!, Number(p._sum.amount ?? 0));

  const buckets: AgingBucketTotals = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  let totalReceivable = 0;
  let invoiceCount = 0;
  for (const inv of invoices) {
    const basisDate = basis === "issue" ? inv.actualIssueDate : (inv.dueDate ?? inv.actualIssueDate);
    if (!basisDate) continue;
    if (asOf.getTime() < new Date(basisDate).getTime()) continue;
    const days = daysBetweenUtc(asOf, new Date(basisDate));
    const remain = new Prisma.Decimal(inv.amount).minus(paidMap.get(inv.id) ?? 0);
    if (remain.lessThanOrEqualTo(MONEY_TOLERANCE)) continue;
    const bucket = bucketOf(days);
    buckets[bucket] = round2(new Prisma.Decimal(buckets[bucket]).plus(remain));
    totalReceivable = round2(new Prisma.Decimal(totalReceivable).plus(remain));
    invoiceCount += 1;
  }
  return { buckets, totalReceivable, invoiceCount };
}

/** 每日幂等 upsert 近 days 天 (含今天) 的两个 basis。返回 upsert 条数。 */
export async function runAgingSnapshot(now: Date = new Date(), days = 30): Promise<AgingSnapshotResult> {
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let upserted = 0;
  for (const basis of ["issue", "due"] as const) {
    for (let i = days - 1; i >= 0; i--) {
      const asOf = new Date(todayUtc);
      asOf.setUTCDate(asOf.getUTCDate() - i);
      const r = await computeSnapshotForDate(basis, asOf);
      await prisma.agingSnapshot.upsert({
        where: { asOfDate_basis: { asOfDate: asOf, basis } },
        update: {
          bucket0_30: r.buckets["0-30"],
          bucket31_60: r.buckets["31-60"],
          bucket61_90: r.buckets["61-90"],
          bucket90: r.buckets["90+"],
          totalReceivable: r.totalReceivable,
          invoiceCount: r.invoiceCount
        },
        create: {
          asOfDate: asOf,
          basis,
          bucket0_30: r.buckets["0-30"],
          bucket31_60: r.buckets["31-60"],
          bucket61_90: r.buckets["61-90"],
          bucket90: r.buckets["90+"],
          totalReceivable: r.totalReceivable,
          invoiceCount: r.invoiceCount
        }
      });
      upserted += 1;
    }
  }
  return { upserted, days };
}