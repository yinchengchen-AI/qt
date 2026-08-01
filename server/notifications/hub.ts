// 进程内通知 hub (SSE 广播源)
//
// 设计:emit 写入 inbox 消息完全不变(不动 5 个 caller,无事务回滚复杂度),
// SSE 端点用 "kick" 模式:
//   - 前端 EventSource 订阅
//   - 后台 5s setInterval 给所有活跃订阅者推 {kind:"kick"}
//   - 前端收到 kick → mutate SWR cache of unread-count,重拉一次
//   - 实际通知延迟 = max(SSE 推送间隔, 5s) + 前端 SWR 重拉
//   - 60s polling 保留作为 EventSource 错误时的兜底
//
// 多实例扩展(本期不做):切换 Redis pub/sub,API 形状不变。
// 心跳 25s 避免 idle 60s nginx/proxy 切断。
import { logger } from "@/lib/logger";

export type NotificationEvent =
  | { kind: "kick"; at: string }                                    // "请重拉 unread-count / messages"
  | { kind: "test"; payload: Record<string, unknown> };             // 测试用

type Subscriber = {
  userId: string;
  controller: ReadableStreamDefaultController<Uint8Array>;
};

const encoder = new TextEncoder();
const subscribers = new Map<string, Set<Subscriber>>();

const HEARTBEAT_FRAME = encoder.encode(":keepalive\n\n");

function frame(event: NotificationEvent): Uint8Array {
  return encoder.encode(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
}

/** 订阅某用户的通知流。 */
export function subscribe(userId: string, controller: ReadableStreamDefaultController<Uint8Array>): () => void {
  let set = subscribers.get(userId);
  if (!set) {
    set = new Set();
    subscribers.set(userId, set);
  }
  const sub: Subscriber = { userId, controller };
  set.add(sub);
  logger.debug?.(`[notifications] subscribe uid=${userId} (active=${set.size})`);
  return () => {
    set!.delete(sub);
    if (set!.size === 0) subscribers.delete(userId);
    logger.debug?.(`[notifications] unsubscribe uid=${userId} (active=${set!.size ?? 0})`);
  };
}

/** 推 kick 到某用户的所有连接;返回成功推送的连接数。 */
export function broadcastKick(userId: string): number {
  const set = subscribers.get(userId);
  if (!set || set.size === 0) return 0;
  const f = frame({ kind: "kick", at: new Date().toISOString() });
  let ok = 0;
  for (const sub of set) {
    try {
      sub.controller.enqueue(f);
      ok++;
    } catch {
      set.delete(sub);
    }
  }
  return ok;
}

/** 推 kick 给所有活跃订阅者;返回成功推送的连接数。用于 scheduler 全员定时踢。 */
export function broadcastKickAll(): number {
  const f = frame({ kind: "kick", at: new Date().toISOString() });
  let ok = 0;
  for (const set of subscribers.values()) {
    for (const sub of set) {
      try {
        sub.controller.enqueue(f);
        ok++;
      } catch {
        set.delete(sub);
      }
    }
  }
  return ok;
}

export function heartbeatFrame(): Uint8Array {
  return HEARTBEAT_FRAME;
}

/** 仅测试用 */
export function _resetForTests(): void {
  subscribers.clear();
}
export function _activeCount(): number {
  let n = 0;
  for (const s of subscribers.values()) n += s.size;
  return n;
}
