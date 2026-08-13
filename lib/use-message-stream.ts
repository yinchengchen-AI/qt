"use client";
import { useEffect, useRef } from "react";

type KickListener = () => void;

let sharedEs: EventSource | null = null;
const listeners = new Set<KickListener>();

function ensureSharedStream() {
  if (sharedEs) return;
  if (typeof window === "undefined") return;
  if (typeof EventSource === "undefined") return;

  sharedEs = new EventSource("/api/messages/stream", { withCredentials: true });

  sharedEs.addEventListener("kick", () => {
    for (const fn of listeners) {
      try { fn(); } catch { /* listener error */ }
    }
  });

  sharedEs.addEventListener("error", () => {
    console.debug("[useMessageStream] SSE error — auto-reconnects");
  });
}

type Options = {
  onKick?: () => void;
  enabled?: boolean;
};

export function useMessageStream({ onKick, enabled = true }: Options): void {
  const listenerRef = useRef<KickListener | undefined>(onKick);
  listenerRef.current = onKick;

  useEffect(() => {
    if (!enabled) return;
    ensureSharedStream();

    const handler = () => listenerRef.current?.();
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, [enabled]);
}
