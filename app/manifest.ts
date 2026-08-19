import type { MetadataRoute } from "next";

// PWA manifest (Phase 5): 可添加到主屏幕, standalone 启动
// 推送不在本期 — spec §8.3: PWA 推送仅作站内信增强通道, 关键提醒以站内信为准
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "企泰安全业务管理系统",
    short_name: "企泰安全",
    description: "客户 / 合同 / 开票 / 回款一体化管理",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#F5F7FA",
    theme_color: "#0A1C33",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }
    ]
  };
}
