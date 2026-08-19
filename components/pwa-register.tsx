"use client";
import { useEffect } from "react";

/** PWA Service Worker 注册 (Phase 5); 生产环境才注册, dev 不污染 localhost 缓存调试 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // 注册失败不阻塞应用; 站内信等核心功能不受影响
    });
  }, []);
  return null;
}
