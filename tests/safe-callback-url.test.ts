// callbackUrl 安全校验单测 (P1-4)
// 见 lib/safe-callback-url.ts
import { describe, it, expect } from "vitest";
import { safeCallbackUrl } from "@/lib/safe-callback-url";

const ORIGIN = "https://qt.example.com";

describe("safeCallbackUrl 开放重定向防护", () => {
  it("空 / null / undefined 走 fallback", () => {
    expect(safeCallbackUrl(null, ORIGIN)).toBe("/dashboard");
    expect(safeCallbackUrl(undefined, ORIGIN)).toBe("/dashboard");
    expect(safeCallbackUrl("", ORIGIN)).toBe("/dashboard");
  });

  it("正常站内路径原样保留", () => {
    expect(safeCallbackUrl("/dashboard", ORIGIN)).toBe("/dashboard");
    expect(safeCallbackUrl("/customers/123?tab=open", ORIGIN)).toBe(
      "/customers/123?tab=open"
    );
    expect(safeCallbackUrl("/contracts#detail", ORIGIN)).toBe("/contracts#detail");
  });

  it("protocol-relative (//evil.com) 走 fallback", () => {
    expect(safeCallbackUrl("//evil.com", ORIGIN)).toBe("/dashboard");
    expect(safeCallbackUrl("//evil.com/foo", ORIGIN)).toBe("/dashboard");
  });

  it("反斜杠绕过 (/\\evil.com) 走 fallback", () => {
    expect(safeCallbackUrl("/\\evil.com", ORIGIN)).toBe("/dashboard");
  });

  it("显式协议 (https://, javascript:, data:, vbscript:) 走 fallback", () => {
    expect(safeCallbackUrl("https://evil.com", ORIGIN)).toBe("/dashboard");
    expect(safeCallbackUrl("http://evil.com", ORIGIN)).toBe("/dashboard");
    expect(safeCallbackUrl("javascript:alert(1)", ORIGIN)).toBe("/dashboard");
    expect(safeCallbackUrl("data:text/html,<script>", ORIGIN)).toBe("/dashboard");
    expect(safeCallbackUrl("vbscript:msgbox", ORIGIN)).toBe("/dashboard");
  });

  it("userinfo (//user@host) 走 fallback", () => {
    expect(safeCallbackUrl("//attacker@evil.com/path", ORIGIN)).toBe("/dashboard");
  });

  it("相对路径不以 / 开头 走 fallback", () => {
    expect(safeCallbackUrl("dashboard", ORIGIN)).toBe("/dashboard");
    expect(safeCallbackUrl("javascript:alert(1)", ORIGIN)).toBe("/dashboard");
  });

  it("SSR 模式 (origin=空): 仅做基础白名单", () => {
    // 没 origin 时只保证 "是站内路径" 这个最低门槛, 客户端水合后会再校一次
    expect(safeCallbackUrl("/dashboard", "")).toBe("/dashboard");
    expect(safeCallbackUrl("//evil.com", "")).toBe("/dashboard");
    expect(safeCallbackUrl("javascript:alert(1)", "")).toBe("/dashboard");
  });

  it("伪装成 path 的 cross-origin URL 走 fallback", () => {
    // /\evil.com 在 URL 解析里 host 会变成 evil.com
    expect(safeCallbackUrl("/\\evil.com", ORIGIN)).toBe("/dashboard");
    // ///evil.com 三斜杠
    expect(safeCallbackUrl("///evil.com", ORIGIN)).toBe("/dashboard");
  });
});
