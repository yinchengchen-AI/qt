// 合同过期未结清提醒 (stale contract notice)
//
// 场景: 合同 endDate 已过, 但开票/回款未达到 ratio 阈值, 不会走 tryAutoClose.
// 这类合同会无限期 ACTIVE, owner / admin 需要被持续提醒去催款 / 处理。
//
// 触发: tickStaleContracts, 接入 runAllJobs, cron 每小时跑一次。
//
// 判定 (与 tryAutoClose 镜像, 互不重复):
//   - status = ACTIVE
//   - endDate < now
//   - 累计已确认回款 (CONFIRMED + RECONCILED) < totalAmount * ratio
//
// 通知: 给 ownerUserId + 所有 ACTIVE 非系统 admin 发站内信, message.type = CONTRACT_EXPIRED_UNPAID.
// 提示文案会带上 graceDays 倒数, 让 admin 知道"还剩几天会被系统强关"。
//
// 去重: 按 (type + entityId + 今日) 维度, 已有相同消息则跳过, 避免每天刷屏。
//   查询走 Message 表 (MessageType 复合索引已建)。
//
// 注意: 已经在宽限期内 (endDate+GRACE<now) 的合同, 文案会换成"已过宽限期, 下次 cron 会被强关";
//       距宽限期还远的, 文案带天数倒数。
import { prisma } from "@/lib/prisma";
import { emit, listAdminUserIds } from "@/server/events/bus";
import { env } from "@/lib/env";
import type { JobResult } from "./runner";

const DAY_MS = 86_400_000;

export async function tickStaleContracts(now: Date): Promise<JobResult> {
  const t0 = Date.now();
  const ratio = env.CONTRACT_COMPLETION_INVOICE_RATIO;
  const graceDays = env.CONTRACT_OVERDUE_GRACE_DAYS;
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // 1) 找出所有 endDate < now 且 ACTIVE 的合同 (含 unpriced)
  const candidates = await prisma.contract.findMany({
    where: { status: "ACTIVE", endDate: { lt: now }, deletedAt: null },
    select: { id: true, contractNo: true, totalAmount: true, endDate: true, ownerUserId: true }
  });
  if (candidates.length === 0) {
    return { job: "contract-stale-notify", created: 0, scanned: 0, durationMs: Date.now() - t0 };
  }

  // 2) 一次性 groupBy 所有候选合同的实际入账回款 (避免 N+1)
  const paidAgg = await prisma.payment.groupBy({
    by: ["contractId"],
    where: {
      contractId: { in: candidates.map((c) => c.id) },
      status: { in: ["CONFIRMED", "RECONCILED"] },
      deletedAt: null
    },
    _sum: { amount: true }
  });
  const paidByContract = new Map<string, number>(
    paidAgg.map((p) => [p.contractId, Number(p._sum.amount ?? 0)])
  );

  // 3) 拉今天已发的 stale 通知, 跳过已发过的合同 (按 (type + entityId + 今日) 去重)
  const alreadySent = await prisma.message.findMany({
    where: {
      type: "CONTRACT_EXPIRED_UNPAID",
      createdAt: { gte: todayStart }
    },
    select: { link: true }
  });
  const sentContractIds = new Set(
    alreadySent
      .map((m) => (m.link as { id?: string } | null)?.id)
      .filter((id): id is string => !!id)
  );

  // 4) admin 列表 (一次性)
  const admins = await listAdminUserIds(prisma);

  let created = 0;
  let scanned = 0;
  for (const c of candidates) {
    scanned++;
    if (sentContractIds.has(c.id)) continue;
    const total = Number(c.totalAmount);
    const threshold = total * ratio;
    const paid = paidByContract.get(c.id) ?? 0;
    if (paid >= threshold) continue; // 已结清, 走 tryAutoClose 自动关, 不重复通知
    const daysOverdue = Math.floor((now.getTime() - new Date(c.endDate).getTime()) / DAY_MS);
    const daysUntilForceClose = Math.max(0, graceDays - daysOverdue);
    await emit(prisma, {
      type: "CONTRACT_EXPIRED_UNPAID",
      payload: {
        contractId: c.id,
        contractNo: c.contractNo,
        daysOverdue,
        graceDays,
        daysUntilForceClose,
        paidAmount: paid,
        totalAmount: total,
        remaining: (total - paid).toFixed(2)
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
