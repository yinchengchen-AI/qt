// 证书到期徽章:与 cron `runCertificateExpiryCheck` 的 30/15/7 三档阈值保持一致。
// 抽出 getExpiryStatus 作为纯函数,方便单测,以及后续『到期证书列表』等场景复用。

import { describe, it, expect } from "vitest";
import { getExpiryStatus, statusToLevel, compareLevel } from "@/lib/employee-profile-expiry";

const NOW = new Date("2026-07-05T00:00:00.000Z");

function plusDays(days: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

describe("getExpiryStatus", () => {
  it("null 返回 none", () => {
    expect(getExpiryStatus(null, NOW).kind).toBe("none");
  });

  it("已过期返回 expired + 绝对天数", () => {
    const s = getExpiryStatus(plusDays(-1), NOW);
    expect(s.kind).toBe("expired");
    if (s.kind === "expired") expect(s.days).toBe(1);
  });

  it("已过期 30 天也返回 expired", () => {
    const s = getExpiryStatus(plusDays(-30), NOW);
    expect(s.kind).toBe("expired");
    if (s.kind === "expired") expect(s.days).toBe(30);
  });

  it("0 天当天返回 critical", () => {
    const s = getExpiryStatus(plusDays(0), NOW);
    expect(s).toEqual({ kind: "warn", level: "critical", days: 0 });
  });

  it("7 天边界:第 7 天是 critical,第 8 天是 high", () => {
    expect(getExpiryStatus(plusDays(7), NOW)).toEqual({
      kind: "warn",
      level: "critical",
      days: 7
    });
    expect(getExpiryStatus(plusDays(8), NOW)).toEqual({
      kind: "warn",
      level: "high",
      days: 8
    });
  });

  it("15 天边界:第 15 天是 high,第 16 天是 medium", () => {
    expect(getExpiryStatus(plusDays(15), NOW)).toEqual({
      kind: "warn",
      level: "high",
      days: 15
    });
    expect(getExpiryStatus(plusDays(16), NOW)).toEqual({
      kind: "warn",
      level: "medium",
      days: 16
    });
  });

  it("30 天边界:第 30 天是 medium,第 31 天是 none", () => {
    expect(getExpiryStatus(plusDays(30), NOW)).toEqual({
      kind: "warn",
      level: "medium",
      days: 30
    });
    expect(getExpiryStatus(plusDays(31), NOW).kind).toBe("none");
  });

  it("365 天外:不显示", () => {
    expect(getExpiryStatus(plusDays(365), NOW).kind).toBe("none");
  });
});

describe("statusToLevel", () => {
  it("none → null", () => {
    expect(statusToLevel({ kind: "none" })).toBeNull();
  });
  it("expired → 'expired'", () => {
    expect(statusToLevel({ kind: "expired", days: 3 })).toBe("expired");
  });
  it("warn → level 透传", () => {
    expect(statusToLevel({ kind: "warn", level: "critical", days: 1 })).toBe("critical");
    expect(statusToLevel({ kind: "warn", level: "high", days: 10 })).toBe("high");
    expect(statusToLevel({ kind: "warn", level: "medium", days: 20 })).toBe("medium");
  });
});

describe("compareLevel", () => {
  it("按紧急度升序:expired < critical < high < medium", () => {
    expect(compareLevel("expired", "critical")).toBeLessThan(0);
    expect(compareLevel("critical", "high")).toBeLessThan(0);
    expect(compareLevel("high", "medium")).toBeLessThan(0);
  });
  it("相同档位返回 0", () => {
    expect(compareLevel("high", "high")).toBe(0);
  });
});
