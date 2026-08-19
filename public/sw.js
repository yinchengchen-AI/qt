// PWA Service Worker (Phase 5)
// 职责边界: 只做应用壳缓存 + 离线兜底; 不拦截 /api (会话与业务数据永远走网络,
// 避免陈旧数据/写操作被缓存吞掉的风险)。推送不在本期, 关键提醒以站内信为准 (spec §8.3)。
const SHELL_CACHE = "qt-shell-v1";
const SHELL_URLS = ["/dashboard", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // 只处理 GET 且非同源 /api 之外的请求; API 与非 GET 一律放行网络
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/")) return;
  // 页面导航: network-first, 断网回退缓存壳
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match("/dashboard").then((r) => r ?? Response.error())
      )
    );
    return;
  }
  // 静态资源 (图标/图片): cache-first
  if (url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(event.request).then((hit) => hit ?? fetch(event.request))
    );
  }
});
