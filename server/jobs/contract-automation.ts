/**
 * 合同状态机自动化定时任务
 *
 * tickPublishableDraffts    — 每小时扫 DRAFT, 字段完整+附件就位 → ACTIVE
 * tickCompletionCandidates  — 每小时扫 ACTIVE, 满足任一自动完结规则 → CLOSED:
 *                              - tryAutoClose:           endDate<now + 双足额 → CLOSED (reason=completed)
 *                              - tryAutoCloseOnOverdue:  endDate+GRACE<now + 未结清 → CLOSED (reason=overdue_terminated)
 */
import { prisma } from "@/lib/prisma";
import { tryAutoPublish, tryAutoClose, tryAutoCloseOnOverdue } from "@/server/services/contract";
import type { JobResult } from "./runner";

/**
 * 每小时扫一次: DRAFT 中字段/附件已就位的合同, 自动推到 ACTIVE
 * 创建/编辑时已自动触发, 这里兜底防止 cron 中途漏触发或事后补数据的情况
 */
export async function tickPublishableDraffts(): Promise<JobResult> {
  const t0 = Date.now();
  const candidates = await prisma.contract.findMany({
    where: { status: "DRAFT", deletedAt: null },
    select: { id: true }
  });
  let published = 0;
  let scanned = 0;
  for (const c of candidates) {
    try {
      const r = await prisma.$transaction((tx) => tryAutoPublish(tx, c.id));
      if (r === "PUBLISHED") published++;
      scanned++;
    } catch (e) {
      console.warn(
        `[contract-auto-publish] contract ${c.id} failed:`,
        e instanceof Error ? e.message : e
      );
    }
  }
  return {
    job: "contract-auto-publish",
    created: published,
    scanned,
    updated: published,
    durationMs: Date.now() - t0
  };
}

/**
 * 每小时扫一次: ACTIVE 合同, 满足任一自动完结规则 → CLOSED.
 *   - tryAutoClose:           endDate<now + 开票+回款双足额  → CLOSED (reason=completed)
 *   - tryAutoCloseOnOverdue:  endDate+GRACE<now + 未结清       → CLOSED (reason=overdue_terminated)
 * 两条规则互斥: 双足额走 tryAutoClose, 未结清走 tryAutoCloseOnOverdue; 一个合同的两次调用
 * 至多有一个会命中 precondition (另一个会抛 SkipTransition 静默跳过).
 * 走完整事务+重试, 单笔失败不影响其它.
 *
 * Lock 机制 (reviewComment = 'lock:overdue_skip:<batch>'):
 *   - tryAutoClose 路径不受 lock 影响 (钱齐了就正常完结, reviewComment 被覆盖为 'completed')
 *   - tryAutoCloseOnOverdue 路径会跳过 lock 合同 (财务补录期间临时豁免强关)
 *   - 补录完成后可人工解锁: UPDATE Contract SET reviewComment = NULL WHERE id = ...
 */
export async function tickCompletionCandidates(now: Date): Promise<JobResult> {
  const t0 = Date.now();
  const candidates = await prisma.contract.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true, reviewComment: true }
  });
  let closed = 0;
  let scanned = 0;
  for (const c of candidates) {
    scanned++;
    try {
      // 优先尝试"已结清"路径 (双足额 + endDate<now)
      // 锁定合同也跑这一条: 钱齐了就完结 (reviewComment 被覆盖为 'completed', lock 自然消除)
      let r = await tryAutoClose(c.id, now);
      if (r === "CLOSED") {
        closed++;
        continue;
      }
      // 如果上面 skip (意味着 endDate>=now 或未双足额), 再试"宽限期过期"路径
      // 但跳过 lock:overdue_skip:* 标记的合同 (财务补录期间临时豁免强关, 避免反复关-开-关)
      if (c.reviewComment?.startsWith("lock:overdue_skip:")) {
        continue;
      }
      r = await tryAutoCloseOnOverdue(c.id, now);
      if (r === "CLOSED") closed++;
    } catch (e) {
      console.warn(
        `[contract-auto-complete] contract ${c.id} failed:`,
        e instanceof Error ? e.message : e
      );
    }
  }
  return {
    job: "contract-auto-complete",
    created: closed,
    scanned,
    updated: closed,
    durationMs: Date.now() - t0
  };
}
