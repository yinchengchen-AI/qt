// 通知 kick 调度器:5s 一次给所有活跃 SSE 订阅者推 "kick",
// 前端收到后 mutate SWR cache,实现"事件式"前端更新。
//
// 为什么 5s 而不是 cron emit hook:
//   - emit 写 Message 在事务内,如果事务回滚 hook 已发,kick 会让前端重拉到无变化
//   - 5s 周期是把 60s polling 加速,延迟从 60s → ≤5s,比 polling 强 12 倍
//   - 简单可靠,无回滚/竞态复杂度
//
// 单例启动:Next.js dev hot-reload 会重新 import,globalThis 哨兵防重复启动。
import { broadcastKickAll } from "./hub";
import { logger } from "@/lib/logger";

const KICK_INTERVAL_MS = 5_000;

declare global {
  // eslint-disable-next-line no-var
  var __qt_notif_kick_scheduler: { interval: ReturnType<typeof setInterval> } | undefined;
}

export function startKickScheduler(): void {
  if (globalThis.__qt_notif_kick_scheduler) return;
  const interval = setInterval(() => {
    const delivered = broadcastKickAll();
    if (delivered > 0) logger.debug?.(`[notif-scheduler] kicked ${delivered} connections`);
  }, KICK_INTERVAL_MS);
  // unref:不阻止进程退出
  if (typeof interval.unref === "function") interval.unref();
  globalThis.__qt_notif_kick_scheduler = { interval };
  logger.info?.("[notif-scheduler] started, interval=5s");
}

export function stopKickScheduler(): void {
  if (!globalThis.__qt_notif_kick_scheduler) return;
  clearInterval(globalThis.__qt_notif_kick_scheduler.interval);
  globalThis.__qt_notif_kick_scheduler = undefined;
}

// 启动:在 server 启动时由 SSE 端点 import 触发
startKickScheduler();
