// 合同过期未结清提醒 (stale contract notice)
//
// 场景: 合同 endDate 已过, 但开票/回款未达到 ratio 阈值, 不会走 tryAutoClose.
// 这类合同会无限期 ACTIVE, owner / admin 需要被持续提醒去催款 / 处理。
//
// 触发: tickStaleContracts, 接入 runAllJobs, cron 每小时跑一次。
//
// 判定 (与 tryAutoClose 镜像, 互不重复; 阈值口径 = Decimal + MONEY_TOLERANCE, 同 status.ts):
//   - status = ACTIVE
//   - endDate < now
//   - 分支 A: 累计已确认回款 (CONFIRMED + RECONCILED) < totalAmount * ratio
//     → CONTRACT_EXPIRED_UNPAID (催款)
//   - 分支 B: 回款已足额, 但开票 (INVOICE_ISSUED_AMOUNT_STATUSES 口径) < totalAmount * ratio
//     → CONTRACT_PAID_INVOICE_PENDING (催补开发票; 否则 tryAutoClose 永不完结它也无人感知)
//
// 通知: 给 ownerUserId + 所有 ACTIVE 非系统 admin 发站内信.
// 分支 A 提示文案会带上 graceDays 倒数, 让 admin 知道"还剩几天会被系统强关"。
//
// 去重: 按 (type + entityId + 今日) 维度, 已有相同消息则跳过, 避免每天刷屏。
//   查询走 Message 表 (MessageType 复合索引已建)。
//
// 注意: 已经在宽限期内 (endDate+GRACE<now) 的合同, 文案会换成"已过宽限期, 下次 cron 会被强关";
//       距宽限期还远的, 文案带天数倒数。
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { emit, listAdminUserIds } from "@/server/events/bus";
import { env } from "@/lib/env";
import { MONEY_TOLERANCE } from "@/lib/money-tolerance";
import { INVOICE_ISSUED_AMOUNT_STATUSES } from "@/lib/invoice-amounts";
import type { JobResult } from "./runner";

const DAY_MS = 86_400_000;

export async function tickStaleContracts(now: Date): Promise<JobResult> {
  const t0 = Date.now();
  const fallbackRatio = env.CONTRACT_COMPLETION_INVOICE_RATIO;
  const graceDays = env.CONTRACT_OVERDUE_GRACE_DAYS;
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // 1) 找出所有 endDate < now 且 ACTIVE 的合同 (含 unpriced)
  const candidates = await prisma.contract.findMany({
    where: { status: "ACTIVE", endDate: { lt: now }, deletedAt: null },
    select: { id: true, contractNo: true, totalAmount: true, endDate: true, ownerUserId: true, completionInvoiceRatio: true }
  });
  if (candidates.length === 0) {
    return { job: "contract-stale-notify", created: 0, scanned: 0, durationMs: Date.now() - t0 };
  }

  const candidateIds = candidates.map((c) => c.id);

  // 2) 一次性 groupBy 所有候选合同的实际入账回款 + 已开票金额 (避免 N+1)
  const [paidAgg, invoicedAgg] = await Promise.all([
    prisma.payment.groupBy({
      by: ["contractId"],
      where: {
        contractId: { in: candidateIds },
        status: { in: ["CONFIRMED", "RECONCILED"] },
        deletedAt: null
      },
      _sum: { amount: true }
    }),
    prisma.invoice.groupBy({
      by: ["contractId"],
      where: {
        contractId: { in: candidateIds },
        status: { in: [...INVOICE_ISSUED_AMOUNT_STATUSES] },
        deletedAt: null
      },
      _sum: { amount: true }
    })
  ]);
  const paidByContract = new Map<string, Prisma.Decimal>(
    paidAgg.map((p) => [p.contractId, new Prisma.Decimal(p._sum.amount?.toString() ?? "0")])
  );
  const invoicedByContract = new Map<string, Prisma.Decimal>(
    invoicedAgg.map((i) => [i.contractId, new Prisma.Decimal(i._sum.amount?.toString() ?? "0")])
  );

  // 3) 拉今天已发的 stale 通知 (两种 type), 跳过已发过的合同 (按 (type + entityId + 今日) 去重)
  const alreadySent = await prisma.message.findMany({
    where: {
      type: { in: ["CONTRACT_EXPIRED_UNPAID", "CONTRACT_PAID_INVOICE_PENDING"] },
      createdAt: { gte: todayStart }
    },
    select: { type: true, link: true }
  });
  const sentUnpaidIds = new Set(
    alreadySent
      .filter((m) => m.type === "CONTRACT_EXPIRED_UNPAID")
      .map((m) => (m.link as { id?: string } | null)?.id)
      .filter((id): id is string => !!id)
  );
  const sentInvoicePendingIds = new Set(
    alreadySent
      .filter((m) => m.type === "CONTRACT_PAID_INVOICE_PENDING")
      .map((m) => (m.link as { id?: string } | null)?.id)
      .filter((id): id is string => !!id)
  );

  // 4) admin 列表 (一次性)
  const admins = await listAdminUserIds(prisma);

  let created = 0;
  let scanned = 0;
  for (const c of candidates) {
    scanned++;
    // 阈值口径与 status.ts tryAutoClose 一致: 行级 completionInvoiceRatio (env 兜底)
    // + Decimal + MONEY_TOLERANCE, 避免 JS number 浮点/容差漂移导致"差 1 分钱不提醒"
    const ratio = Number(c.completionInvoiceRatio ?? fallbackRatio);
    const total = new Prisma.Decimal(c.totalAmount.toString());
    const effectiveThreshold = total.mul(ratio).minus(MONEY_TOLERANCE);
    const paid = paidByContract.get(c.id) ?? new Prisma.Decimal(0);
    const daysOverdue = Math.floor((now.getTime() - new Date(c.endDate).getTime()) / DAY_MS);

    if (paid.greaterThanOrEqualTo(effectiveThreshold)) {
      // 分支 B: 钱已收齐 — 开票也足额则走 tryAutoClose 自动关, 不通知;
      // 开票不足额则是"永不完结也无人感知"的盲区, 提醒补开发票
      const invoiced = invoicedByContract.get(c.id) ?? new Prisma.Decimal(0);
      if (invoiced.greaterThanOrEqualTo(effectiveThreshold)) continue;
      if (sentInvoicePendingIds.has(c.id)) continue;
      await emit(prisma, {
        type: "CONTRACT_PAID_INVOICE_PENDING",
        payload: {
          contractId: c.id,
          contractNo: c.contractNo,
          daysOverdue,
          paidAmount: paid.toFixed(2),
          totalAmount: total.toFixed(2),
          invoicedAmount: invoiced.toFixed(2),
          remaining: total.minus(invoiced).toFixed(2)
        },
        receivers: Array.from(new Set([c.ownerUserId, ...admins]))
      });
      created++;
      continue;
    }

    // 分支 A: 回款未足额 → 催款 (原 CONTRACT_EXPIRED_UNPAID 路径)
    if (sentUnpaidIds.has(c.id)) continue;
    const daysUntilForceClose = Math.max(0, graceDays - daysOverdue);
    await emit(prisma, {
      type: "CONTRACT_EXPIRED_UNPAID",
      payload: {
        contractId: c.id,
        contractNo: c.contractNo,
        daysOverdue,
        graceDays,
        daysUntilForceClose,
        paidAmount: paid.toNumber(),
        totalAmount: total.toNumber(),
        remaining: total.minus(paid).toFixed(2)
      },
      receivers: Array.from(new Set([c.ownerUserId, ...admins]))
    });
    created++;
  }
  return {
    job: "contract-stale-notify",
    created,
    scanned,
    durationMs: Date.now() - t0
  };
}
