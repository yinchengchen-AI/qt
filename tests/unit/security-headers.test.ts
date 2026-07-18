// 安全响应头回归测试 (next.config.mjs#headers)
// 2026-07-11 CSP hardening 漏配 frame-src, 回落 default-src 'self' 后
// 合同附件 PDF 预览 (<iframe src=blob:>) 被浏览器拦截 — 合同管理附件无法预览。
// 此测试钉死: CSP 必须显式允许 blob: 框架源 (PDF 预览) 与 blob: 图片源 (图片预览)。

import { describe, it, expect } from "vitest";
// @ts-expect-error -- next.config.mjs 无类型声明, 运行时按 ESM 导入即可
import nextConfig from "../../next.config.mjs";

async function cspValue(): Promise<string> {
  const groups = await nextConfig.headers();
  const all = groups.flatMap((g: { headers: { key: string; value: string }[] }) => g.headers);
  const csp = all.find(
    (h: { key: string; value: string }) => h.key.toLowerCase() === "content-security-policy"
  );
  expect(csp, "必须配置 Content-Security-Policy 头").toBeTruthy();
  return csp.value as string;
}

describe("CSP 安全头回归", () => {
  it("frame-src 允许 blob: (PDF 附件 iframe 预览)", async () => {
    const csp = await cspValue();
    const frameSrc = csp.split(";").map((d: string) => d.trim()).find((d: string) => d.startsWith("frame-src"));
    expect(frameSrc, "CSP 缺 frame-src; 会回落 default-src 'self' 拦截 blob: iframe").toBeTruthy();
    expect(frameSrc).toContain("blob:");
  });

  it("img-src 允许 blob: (图片附件预览)", async () => {
    const csp = await cspValue();
    const imgSrc = csp.split(";").map((d: string) => d.trim()).find((d: string) => d.startsWith("img-src"));
    expect(imgSrc).toBeTruthy();
    expect(imgSrc).toContain("blob:");
  });
});
