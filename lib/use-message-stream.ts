"use client";
// 共享 SSE 连接 (v0.22.0)
//
// 协议 (v0.22.0+):
//   - ready     → 连接建立 (后端 emit)
//   - kick      → 让前端重拉 unread-count / 列表 (兜底)
//   - message:new → 后端直推一条新消息 row, 前端 prepend 进列表
//   - error     → EventSource 自动重连, 关闭浏览器或 React 卸载时无操作
//
// 单例 EventSource,跨多个组件共享。组件各自注册 listener,卸载时移除。
import { useEffect, useRef } from "react";
import type { MessageRowPayload } from "@/lib/message-types";

type KickListener = () => void;
type NewMessageListener = (row: MessageRowPayload) => void;

let sharedEs: EventSource | null = null;
const kickListeners = new Set<KickListener>();
const newMessageListeners = new Set<NewMessageListener>();

function ensureSharedStream() {
  if (sharedEs) return;
  if (typeof window === "undefined") return;
  if (typeof EventSource === "undefined") return;

  sharedEs = new EventSource("/api/messages/stream", { withCredentials: true });

  sharedEs.addEventListener("kick", () => {
    for (const fn of kickListeners) {
      try { fn(); } catch { /* listener error */ }
    }
  });

  sharedEs.addEventListener("message:new", (ev) => {
    let row: MessageRowPayload | null = null;
    try {
      const data = JSON.parse((ev as MessageEvent).data) as { payload: MessageRowPayload };
      row = data.payload ?? null;
    } catch {
      row = null;
    }
    if (!row) return;
    for (const fn of newMessageListeners) {
      try { fn(row); } catch { /* listener error */ }
    }
  });

  sharedEs.addEventListener("error", () => {
    // EventSource 自动重连; 这里只 debug
    if (typeof console !== "undefined") {
      console.debug("[useMessageStream] SSE error — auto-reconnects");
    }
  });
}

type Options = {
  onKick?: () => void;
  onNewMessage?: (row: MessageRowPayload) => void;
  enabled?: boolean;
};

export function useMessageStream({ onKick, onNewMessage, enabled = true }: Options): void {
  const kickRef = useRef<KickListener | undefined>(onKick);
  const newRef = useRef<NewMessageListener | undefined>(onNewMessage);
  kickRef.current = onKick;
  newRef.current = onNewMessage;

  useEffect(() => {
    if (!enabled) return;
    ensureSharedStream();

    const kickHandler = () => kickRef.current?.();
    const newHandler = (row: MessageRowPayload) => newRef.current?.(row);
    kickListeners.add(kickHandler);
    newMessageListeners.add(newHandler);
    return () => {
      kickListeners.delete(kickHandler);
      newMessageListeners.delete(newHandler);
    };
  }, [enabled]);
}
