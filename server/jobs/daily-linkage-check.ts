// 联动补盲每日检查 (Phase 3, spec §6.1)
//
// 两条检查 (判定逻辑在 server/services/contract/linkage-checks.ts, 与详情页 overview warnings 同源):
//   A 超期未开票: ACTIVE 且 startDate <= now-30d 且无已开票发票 → 站内信 owner
//   B 开票-回款偏差: 已开票>=1万 且 (已开票-已回款)/已开票 > 20% 且最新发票开具超 30 天
//      → 站内信 owner + 财务 (与 INVOICE_OVERDUE_PAYMENT 按发票粒度互补: 本条按合同聚合)
//
// 去重: entityKey = {TYPE}:{contractId}:{yyyy-MM-dd} 按日去重;
//       job 内先做"今日已发"第一道过滤 (与 stale-contract 同模式), createMany skipDuplicates 兜底。
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { emit } from "@/server/events/bus";
import { INVOICE_ISSUED_AMOUNT_STATUSES } from "@/lib/invoice-amounts";
import { isNoInvoiceOverdue, isInvoicePaymentGap, NO_INVOICE_DAYS } from "@/server/services/contract/linkage-checks";
import type { JobResult } from "./runner";

const DAY_MS = 86_400_000;

function todayStart(now: Date): Date {
  const t = new Date(now);
  t.setHours(0, 0, 0, 0);
  return t;
}

export async function runDailyLinkageCheck(now = new Date()): Promise<JobResult> {
  const t0 = Date.now();
  const today = todayStart(now);
  const dayKey = now.toISOString().slice(0, 10);
  const noInvoiceCutoff = new Date(now.getTime() - NO_INVOICE_DAYS * DAY_MS);

  const contracts = await prisma.contract.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, contractNo: true, customerName: true, startDate: true, status: true, ownerUserId: true }
  });
  const scanned = contracts.length;
  if (scanned === 0) {
    return { job: "daily-linkage-check", created: 0, scanned: 0, durationMs: Date.now() - t0 };
  }
  const ids = contracts.map((c) => c.id);

  // 预聚合 (禁 N+1): 已开票合计 + 最新发票开具日 (同查询 _max) + 已确认回款合计
  const [invoicedAgg, paidAgg] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["contractId"],
      where: { contractId: { in: ids }, status: { in: [...INVOICE_ISSUED_AMOUNT_STATUSES] }, deletedAt: null },
      _sum: { amount: true },
      _max: { actualIssueDate: true }
    }),
    prisma.payment.groupBy({
      by: ["contractId"],
      where: { contractId: { in: ids }, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null },
      _sum: { amount: true }
    })
  ]);
  const invoicedByContract = new Map(
    invoicedAgg.map((i) => [i.contractId, { amount: new Prisma.Decimal(i._sum.amount?.toString() ?? "0"), latest: i._max.actualIssueDate }])
  );
  const paidByContract = new Map(
    paidAgg.map((p) => [p.contractId, new Prisma.Decimal(p._sum.amount?.toString() ?? "0")])
  );

  // 今日已发过滤 (两种 type 一次查)
  const alreadySent = await prisma.message.findMany({
    where: {
      type: { in: ["LINKAGE_NO_INVOICE", "LINKAGE_INVOICE_PAYMENT_GAP"] },
      createdAt: { gte: today }
    },
    select: { entityKey: true }
  });
  const sentToday = new Set(alreadySent.map((m) => m.entityKey));

  // 财务接收人 (判定 B 抄送); 循环外一次性拉取
  const finance = await prisma.user.findMany({
    where: { role: { code: "FINANCE" }, deletedAt: null, status: "ACTIVE", isSystem: false },
    select: { id: true }
  });
  const financeIds = finance.map((f) => f.id);

  let created = 0;
  for (const c of contracts) {
    const invoiced = invoicedByContract.get(c.id);
    const hasIssuedInvoice = !!invoiced && invoiced.amount.greaterThan(0);

    // P2003 容忍: 并发测试清理会硬删 owner 用户/合同 (生产全软删, 正常路径不触发)
    // 判定 A: 超期未开票 (只对 startDate 已过 30 天的合同评估, 快速跳过)
    if (c.startDate.getTime() <= noInvoiceCutoff.getTime() && isNoInvoiceOverdue(c, hasIssuedInvoice, now)) {
      const entityKey = `LINKAGE_NO_INVOICE:${c.id}:${dayKey}`;
      if (!sentToday.has(entityKey)) {
        const daysSinceStart = Math.floor((now.getTime() - c.startDate.getTime()) / DAY_MS);
        try {
          await emit(prisma, {
            type: "LINKAGE_NO_INVOICE",
            payload: { contractId: c.id, contractNo: c.contractNo, customerName: c.customerName, daysSinceStart },
            entityKey,
            receivers: [c.ownerUserId]
          });
          created++;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") continue;
          throw e;
        }
      }
    }

    // 判定 B: 开票-回款偏差
    const paid = paidByContract.get(c.id) ?? new Prisma.Decimal(0);
    if (isInvoicePaymentGap({
      status: c.status,
      invoicedAmount: invoiced?.amount ?? 0,
      paidAmount: paid,
      latestInvoiceDate: invoiced?.latest ?? null
    }, now)) {
      const entityKey = `LINKAGE_INVOICE_PAYMENT_GAP:${c.id}:${dayKey}`;
      if (!sentToday.has(entityKey)) {
        const inv = invoiced!.amount;
        const gap = inv.minus(paid);
        try {
          await emit(prisma, {
            type: "LINKAGE_INVOICE_PAYMENT_GAP",
            payload: {
              contractId: c.id,
              contractNo: c.contractNo,
              customerName: c.customerName,
              invoicedAmount: inv.toFixed(2),
              paidAmount: paid.toFixed(2),
              gapAmount: gap.toFixed(2),
              gapRatio: gap.div(inv).mul(100).toFixed(1)
            },
            entityKey,
            receivers: Array.from(new Set([c.ownerUserId, ...financeIds]))
          });
          created++;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") continue;
          throw e;
        }
      }
    }
  }
  return { job: "daily-linkage-check", created, scanned, durationMs: Date.now() - t0 };
}
