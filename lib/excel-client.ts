"use client";
// 浏览器端触发 xlsx 下载的小工具:把当前查询参数拼到导出 URL 上,fetch 拿到 blob,
// 再用一个临时 <a download> 落盘。比直接 <a href> 多了一步鉴权(cookies 走 fetch 带上),
// 否则 download 属性会被 401 拦截。
export async function downloadExcel(url: string, fallbackName = "export.xlsx") {
  try {
    const r = await fetch(url, { credentials: "include" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error((j as { message?: string }).message ?? `下载失败: HTTP ${r.status}`);
    }
    // 从 Content-Disposition 拿真实文件名,fallback 到默认
    const cd = r.headers.get("content-disposition") ?? "";
    const m = /filename=([^;]+)/.exec(cd);
    const name = m?.[1]?.replace(/^"|"$/g, "") || fallbackName;
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}
