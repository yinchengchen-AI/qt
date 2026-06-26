import { prisma } from "@/lib/prisma";
import { listAdminUserIds } from "@/server/events/bus";

import {runTransition, SkipTransition} from "@/lib/status-machine";
import { SYSTEM_USER_ID } from "@/lib/system";

export async function tryAutoCloseOnExpiry(contractId: string, now: Date): Promise<"CLOSED" | "SKIPPED"> {
  const result = await runTransition({
    entity: "Contract",
    id: contractId,
    loadInTx: (tx) => tx.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, status: true, contractNo: true, endDate: true, totalAmount: true, ownerUserId: true },
    }),
    from: ["ACTIVE"],
    to: "CLOSED",
    precondition: async (c, tx) => {
      if (new Date(c.endDate as unknown as Date) >= now) throw new SkipTransition();
      // 过期合同自动关闭前，必须确认开票已足额（>= totalAmount）
      const invoiced = await tx.invoice.aggregate({
        where: { contractId, status: "ISSUED", deletedAt: null },
        _sum: { amount: true },
      });
      const invoicedAmount = Number(invoiced._sum.amount ?? 0);
      const total = Number(c.totalAmount);
      if (invoicedAmount < total) throw new SkipTransition();
    },
    extraData: () => ({ reviewComment: "expired" }),
    audit: (c) => ({
      actorId: SYSTEM_USER_ID,
      action: "CONTRACT_AUTO_CLOSE_EXPIRED",
      before: { status: c.status },
      after: { status: "CLOSED", reason: "expired" },
    }),
    reviewLog: () => ({
      reviewerId: SYSTEM_USER_ID,
      action: "AUTO_CLOSE_EXPIRED",
      comment: "合同已过到期日且开票足额,系统自动置为已完结",
    }),
    event: async (c, tx) => {
      const admins = await listAdminUserIds(tx);
      return {
        type: "CONTRACT_AUTO_EXPIRED",
        payload: { contractId: c.id, contractNo: c.contractNo, endDate: c.endDate },
        receivers: Array.from(new Set([c.ownerUserId, ...admins])),
      };
    },
    silentSkip: true,
  });
  return result.result === "DONE" ? "CLOSED" : "SKIPPED";
}

/**
 * 合同过期定时任务: 扫所有 status ∈ {EFFECTIVE, EXECUTING} 且 endDate < now 的合同,
 * 逐笔调 tryAutoExpireContract. 每笔独立事务, 某笔 P2034 重试耗尽或别处报错不影响其它合同.
 *
 * 返回 JobResult { job, created=转 EXPIRED 数, scanned=候选数, updated=created, durationMs }.
 * runAllJobs 把它注册到与 contract-expiring / contract-expiry 同一组, cron 每日 1:00 触发.
 */

export async function runContractExpiryJob(now: Date): Promise<{
  job: string;
  created: number;
  scanned: number;
  updated: number;
  durationMs: number;
}> {
  const t0 = Date.now();
  const candidates = await prisma.contract.findMany({
    where: {
      status: "ACTIVE",
      endDate: { lt: now },
      deletedAt: null
    },
    select: { id: true }
  });
  let created = 0;
  for (const c of candidates) {
    try {
      const r = await tryAutoCloseOnExpiry(c.id, now);
      if (r === "CLOSED") created++;
    } catch (e) {
      // 单笔转换失败不阻塞整体; warn 一行留痕
      console.warn(`[contract-expiry] contract ${c.id} auto-close failed:`, e instanceof Error ? e.message : e);
    }
  }
  return {
    job: "contract-expiry",
    created,
    scanned: candidates.length,
    updated: created,
    durationMs: Date.now() - t0
  };
}



// =====================================================
// 合同状态机自动转换 — DRAFT → ACTIVE / ACTIVE → CLOSED
// =====================================================
// 触发入口:
//   - tryAutoPublish: createContract / updateContract / tickPublishableDraffts 调
//   - tryAutoComplete: tickCompletionCandidates 调 (满足 R-07: 项目全 ACCEPTED/CLOSED + 开票足额)
//   - tryAutoCloseOnExpiry: 上面已实现, 跑在 runContractExpiryJob
//
// 写 ContractReviewLog.action: AUTO_PUBLISH / AUTO_CLOSE_COMPLETED / AUTO_CLOSE_EXPIRED
// 状态不匹配 → no-op (静默), 不会拖垮主事务.

/**
 * DRAFT → ACTIVE 判定: 字段完整 + 至少 1 附件
 * 字段: customerId / contractNo / title / serviceType / signDate / startDate / endDate /
 *       totalAmount > 0 / taxRate >= 0 / ownerUserId / signerId
 */
