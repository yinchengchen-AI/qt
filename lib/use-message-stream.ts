"use client";
// 订阅 /api/messages/stream 的 EventSource hook
//
// 用法 (典型,在 dashboard-shell 顶层 useEffect):
//   useMessageStream({
//     onKick: () => mutate("/api/messages/unread-count"),
//   });
//
// 行为:
//   - onKick 触发 SWR mutate 让前端重拉 unread-count (60s polling 不动,作为兜底)
//   - onError 会重连 (EventSource 自带);持续错误也不影响业务 polling
//   - 卸载时关闭连接
import { useEffect } from "react";

type Options = {
  onKick?: () => void;
  enabled?: boolean;
};

export function useMessageStream({ onKick, enabled = true }: Options): void {
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    if (typeof EventSource === "undefined") return; // 老浏览器 fallback

    const es = new EventSource("/api/messages/stream", { withCredentials: true });

    const onKick = () => onKickInternal();
    const onReady = () => {/* first frame received, all good */};
    const onError = (e: Event) => {
      // EventSource auto-reconnects;just log for debug
      console.debug("[useMessageStream] error", e);
    };

    function onKickInternal() {
      onKick?.();
    }

    es.addEventListener("kick", onKick);
    es.addEventListener("ready", onReady);
    es.addEventListener("error", onError);

    return () => {
      es.removeEventListener("kick", onKick);
      es.removeEventListener("ready", onReady);
      es.removeEventListener("error", onError);
      es.close();
    };
  }, [onKick, enabled]);
}
