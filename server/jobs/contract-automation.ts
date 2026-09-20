/**
 * 合同状态机自动化定时任务
 *
 * tickPublishableDrafts    — 每小时扫 DRAFT, 字段完整+附件就位 → ACTIVE
 * tickCompletionCandidates  — 每小时扫 ACTIVE, 满足自动完结规则 → CLOSED:
 *                              - tryAutoClose: endDate<now + 开票+回款双 100% 足额 → CLOSED (reason=completed)
 *
 * 注: 原宽限期强关 (tryAutoCloseOnOverdue, endDate+GRACE<now 仍未结清 → CLOSED) 已移除,
 *     过期未结清合同保持 ACTIVE, 由 contract-stale-notify 催款提醒 + admin 手动完结兜底。
 */
import { prisma } from "@/lib/prisma";
import { tryAutoPublish, tryAutoClose } from "@/server/services/contract";
import type { JobResult } from "./runner";

/**
 * 每小时扫一次: DRAFT 中字段/附件已就位的合同, 自动推到 ACTIVE
 * 创建/编辑时已自动触发, 这里兜底防止 cron 中途漏触发或事后补数据的情况
 */
export async function tickPublishableDrafts(): Promise<JobResult> {
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
 * 每小时扫一次: ACTIVE 合同, 满足自动完结规则 → CLOSED.
 *   - tryAutoClose: endDate<now + 开票+回款双 100% 足额 → CLOSED (reason=completed)
 * 走完整事务+重试, 单笔失败不影响其它.
 */
export async function tickCompletionCandidates(now: Date): Promise<JobResult> {
  const t0 = Date.now();
  const candidates = await prisma.contract.findMany({
    where: { status: "ACTIVE", deletedAt: null },
    select: { id: true }
  });
  let closed = 0;
  let scanned = 0;
  for (const c of candidates) {
    scanned++;
    try {
      const r = await tryAutoClose(c.id, now);
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
