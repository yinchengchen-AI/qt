"use client";
// 新窗口打开 detail 的打印页(由 /api/{resource}/{id}/pdf 服务端返回完整 HTML),
// 服务端页面里自带 window.print() 自动唤起,用户在浏览器对话框选"另存为 PDF"。
export function openPrintWindow(url: string) {
  const w = window.open(url, "_blank", "noopener,noreferrer");
  if (!w) {
    throw new Error("浏览器拦截了新窗口,请允许弹窗后重试");
  }
  return w;
}
