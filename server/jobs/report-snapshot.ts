// 报表中心定时任务：生成上一周期（月/季/年）快照
import { generatePeriodSnapshots } from "@/server/services/report";
import { SYSTEM_USER_ID } from "@/lib/system";
import type { JobResult } from "./runner";

/**
 * 生成报表快照（上一周期）。
 * 由 cron 每日触发，只在周期边界日执行：
 * - 每月 1 日生成上月 MONTH 快照
 * - 每季度首日生成上季度 QUARTER 快照
 * - 每年 1 月 1 日生成上年 YEAR 快照
 *
 * 通过 runner.ts 统一调度，与现有定时任务共享鉴权/监控。
 */
export async function runReportSnapshotJob(now = new Date()): Promise<JobResult> {
  const t0 = Date.now();

  const isFirstDayOfMonth = now.getDate() === 1;

  if (!isFirstDayOfMonth) {
    return {
      job: "report-snapshot",
      created: 0,
      scanned: 0,
      updated: 0,
      durationMs: Date.now() - t0,
    };
  }

  try {
    const { created, updated, skipped, failed } = await generatePeriodSnapshots(now, SYSTEM_USER_ID);
    return {
      job: "report-snapshot",
      created,
      scanned: created + updated + skipped + failed,
      updated,
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[report-snapshot] job failed:", reason);
    return {
      job: "report-snapshot",
      created: 0,
      scanned: 0,
      updated: 0,
      durationMs: Date.now() - t0,
      error: reason,
    };
  }
}
