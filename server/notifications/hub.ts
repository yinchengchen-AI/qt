// 进程内通知 hub (SSE 广播源)
//
// 设计:事件驱动推送为主 + 5s scheduler 为安全兜底。
//   - 非事务路径(定时任务 emit):创建消息后立即定向 broadcastNew(receivers,row)+ broadcastKick 兜底
//   - 事务路径(状态机 emit):emit 内部 queueKickKick,外层 $transaction commit 后 flushPendingKicks
//   - scheduler 5s broadcastKickAll 保留为兜底(事务回滚/丢漏场景)
//   - 前端收到 kick → mutate SWR cache of unread-count,重拉一次
//   - 收到 message:new → 直接 prepend 到列表顶,unread badge +1, 不重拉
//   - 60s polling 保留作为 EventSource 错误时的兜底
//
// 多实例扩展(本期不做):切换 Redis pub/sub,API 形状不变。
// 心跳 25s 避免 idle 60s nginx/proxy 切断。
import { logger } from "@/lib/logger";

export type MessageRowPayload = {
  id: string;
  type: string;
  title: string;
  content: string;
  link: unknown;
  createdAt: Date | string;
  receiverUserId: string;
};

export type NotificationEvent =
  | { kind: "kick"; at: string }                                    // "请重拉 unread-count / messages"
  | { kind: "message:new"; payload: MessageRowPayload }            // 新消息直推
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

/** 推 message:new 到单条 row 的接收人 */
export function broadcastNew(row: MessageRowPayload): number {
  const set = subscribers.get(row.receiverUserId);
  if (!set || set.size === 0) return 0;
  const f = frame({
    kind: "message:new",
    payload: {
      ...row,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt
    }
  });
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

// ── 事务内延迟推送: emit 在 $transaction 内调用时,消息未 commit → 不能立即推 kick ──
// queueKickKick 将 receiver userIds 入队; flushPendingKicks 在 transaction commit 后调用,
// 才真正 broadcastKick。若 tx 回滚,queued kick 永远不会 flush(安全无副作用)。
const pendingKickUsers = new Set<string>();

/** 将 userIds 入队等待 flush (事务内 emit 调用)。 */
export function queueKickKick(userIds: string[]): void {
  for (const uid of userIds) pendingKickUsers.add(uid);
}

/** 将所有排队的 userIds 执行 broadcastKick 并清空队列;返回成功推送的连接总数。 */
export function flushPendingKicks(): number {
  const users = [...pendingKickUsers];
  pendingKickUsers.clear();
  if (users.length === 0) return 0;
  let ok = 0;
  for (const uid of users) ok += broadcastKick(uid);
  return ok;
}

export function heartbeatFrame(): Uint8Array {
  return HEARTBEAT_FRAME;
}

/** 仅测试用 */
export function _resetForTests(): void {
  subscribers.clear();
  pendingKickUsers.clear();
}
export function _activeCount(): number {
  let n = 0;
  for (const s of subscribers.values()) n += s.size;
  return n;
}
export function _pendingKickCount(): number {
  return pendingKickUsers.size;
}
