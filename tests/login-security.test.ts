// IP 限速 + 工号归一化 + 密码重置 token 单元测试
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  LOGIN_POLICY,
  countIpFails,
  isIpRateLimited,
  recordIpFail,
  clearIpFails
} from "@/lib/login-rate-limit";
import { normalizeEmployeeNo } from "@/lib/auth";
import {
  hashResetToken,
  generateResetToken,
  buildResetUrl,
  RESET_TOKEN_TTL_MS
} from "@/lib/password-reset";

describe("IP 限速 (lib/login-rate-limit)", () => {
  it("空 bucket 时不算限速", () => {
    expect(isIpRateLimited("1.2.3.4")).toBe(false);
    expect(countIpFails("1.2.3.4")).toBe(0);
  });

  it("达到 IP_MAX_FAILS 触发限速", () => {
    const ip = `10.0.0.${Math.floor(Math.random() * 200)}`;
    for (let i = 0; i < LOGIN_POLICY.IP_MAX_FAILS; i++) {
      recordIpFail(ip);
    }
    expect(isIpRateLimited(ip)).toBe(true);
    expect(countIpFails(ip)).toBe(LOGIN_POLICY.IP_MAX_FAILS);
  });

  it("clearIpFails 清掉计数后立即解除限速", () => {
    const ip = "10.0.0.99";
    for (let i = 0; i < LOGIN_POLICY.IP_MAX_FAILS; i++) {
      recordIpFail(ip);
    }
    expect(isIpRateLimited(ip)).toBe(true);
    clearIpFails(ip);
    expect(isIpRateLimited(ip)).toBe(false);
    expect(countIpFails(ip)).toBe(0);
  });

  it("窗口外的旧失败不计入", () => {
    const ip = "10.0.0.42";
    recordIpFail(ip);
    // 把"现在"挪到窗口外, 验证旧记录已不计数
    const farFuture = Date.now() + LOGIN_POLICY.IP_WINDOW_MS + 1000;
    expect(isIpRateLimited(ip, farFuture)).toBe(false);
    expect(countIpFails(ip, farFuture)).toBe(0);
  });
});

describe("工号归一化 (lib/auth.normalizeEmployeeNo)", () => {
  it("trim + toLowerCase", () => {
    expect(normalizeEmployeeNo("  Admin  ")).toBe("admin");
    expect(normalizeEmployeeNo("QT0001")).toBe("qt0001");
    expect(normalizeEmployeeNo("")).toBe("");
  });

  it("undefined / null / 数字安全降级", () => {
    expect(normalizeEmployeeNo(undefined)).toBe("");
    expect(normalizeEmployeeNo(null)).toBe("");
    expect(normalizeEmployeeNo(123 as unknown as string)).toBe("123");
  });
});

describe("密码重置 token (lib/password-reset)", () => {
  it("hashResetToken 确定性 + 抗碰撞", () => {
    const a = hashResetToken("abc");
    const b = hashResetToken("abc");
    const c = hashResetToken("abd");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64); // SHA-256 hex
  });

  it("generateResetToken 长度够 + 不可预测", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const t = generateResetToken();
      expect(t.length).toBeGreaterThanOrEqual(40);
      set.add(t);
    }
    expect(set.size).toBe(100); // 全部唯一
  });

  it("hash(原始) 等同 SHA-256 hex(token)", () => {
    const token = generateResetToken();
    const expected = createHash("sha256").update(token).digest("hex");
    expect(hashResetToken(token)).toBe(expected);
  });

  it("RESET_TOKEN_TTL_MS = 30 分钟", () => {
    expect(RESET_TOKEN_TTL_MS).toBe(30 * 60 * 1000);
  });

  it("buildResetUrl 用 APP_PUBLIC_URL 拼绝对地址", () => {
    const url = buildResetUrl("abc");
    expect(url).toMatch(/^https?:\/\//);
    expect(url).toContain("/login?resetToken=abc");
  });
});
