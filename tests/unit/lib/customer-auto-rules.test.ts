// 客户状态机自动化规则元数据 (lib/customer-auto-rules.ts) 单元测试
//
// 重点覆盖:
//   - parseDisabledRules / isRuleEnabled 解析 env 字符串 (空/单/多/带空白/未知 id)
//   - getTimeRules 只返回 trigger=time 的规则 (用于 suggest job 升级)
//   - getRuleLabel 兜底行为 (null/未知 id → 规则名或默认值)
//
// 策略: vi.mock @/lib/env, 因为 isRuleEnabled / CUSTOMER_AUTO_RULES 都依赖 env 字段.

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  CUSTOMER_AUTO_RULES_DISABLED: "",
  CUSTOMER_AUTO_INACTIVE_LOST_DAYS: 90,
  CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS: 60
}));

vi.mock("@/lib/env", () => ({
  env: {
    get CUSTOMER_AUTO_RULES_DISABLED() { return mockEnv.CUSTOMER_AUTO_RULES_DISABLED; },
    get CUSTOMER_AUTO_INACTIVE_LOST_DAYS() { return mockEnv.CUSTOMER_AUTO_INACTIVE_LOST_DAYS; },
    get CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS() { return mockEnv.CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS; }
  }
}));

import {
  CUSTOMER_AUTO_RULES,
  isRuleEnabled,
  getTimeRules,
  getRuleLabel
} from "@/lib/customer-auto-rules";

beforeEach(() => {
  mockEnv.CUSTOMER_AUTO_RULES_DISABLED = "";
  mockEnv.CUSTOMER_AUTO_INACTIVE_LOST_DAYS = 90;
  mockEnv.CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS = 60;
});

describe("CUSTOMER_AUTO_RULES - 静态结构", () => {
  it("4 条规则全部存在且 trigger 字段正确", () => {
    expect(Object.keys(CUSTOMER_AUTO_RULES).sort()).toEqual(
      ["ALL_CONTRACTS_CLOSED", "CONTRACT_ACTIVATED", "INACTIVE_FROZEN", "INACTIVE_LOST"].sort()
    );
    expect(CUSTOMER_AUTO_RULES.CONTRACT_ACTIVATED.trigger).toBe("event");
    expect(CUSTOMER_AUTO_RULES.ALL_CONTRACTS_CLOSED.trigger).toBe("event");
    expect(CUSTOMER_AUTO_RULES.INACTIVE_LOST.trigger).toBe("time");
    expect(CUSTOMER_AUTO_RULES.INACTIVE_FROZEN.trigger).toBe("time");
  });

  it("CONTRACT_ACTIVATED 走 FROZEN 作为 revertTarget (因为 SIGNED → NEGOTIATING 不合法)", () => {
    expect(CUSTOMER_AUTO_RULES.CONTRACT_ACTIVATED.targetStatus).toBe("SIGNED");
    expect(CUSTOMER_AUTO_RULES.CONTRACT_ACTIVATED.revertTarget).toBe("FROZEN");
  });

  it("3 个 LOST/FROZEN 规则 revertTarget = NEGOTIATING", () => {
    expect(CUSTOMER_AUTO_RULES.ALL_CONTRACTS_CLOSED.revertTarget).toBe("NEGOTIATING");
    expect(CUSTOMER_AUTO_RULES.INACTIVE_LOST.revertTarget).toBe("NEGOTIATING");
    expect(CUSTOMER_AUTO_RULES.INACTIVE_FROZEN.revertTarget).toBe("NEGOTIATING");
  });

  it("time 规则的 days 字段取自 env", () => {
    mockEnv.CUSTOMER_AUTO_INACTIVE_LOST_DAYS = 120;
    mockEnv.CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS = 80;
    // 重新 import 才能读到新 env; 用 require 模式绕开 ESM 缓存
    vi.resetModules();
    // 不重置 env mock 自身,只重置依赖它的模块缓存
    return import("@/lib/customer-auto-rules").then((m) => {
      expect(m.CUSTOMER_AUTO_RULES.INACTIVE_LOST.days).toBe(120);
      expect(m.CUSTOMER_AUTO_RULES.INACTIVE_FROZEN.days).toBe(80);
    });
  });
});

describe("isRuleEnabled - 解析 CUSTOMER_AUTO_RULES_DISABLED", () => {
  it("空字符串 → 全开", () => {
    mockEnv.CUSTOMER_AUTO_RULES_DISABLED = "";
    expect(isRuleEnabled("INACTIVE_LOST")).toBe(true);
    expect(isRuleEnabled("INACTIVE_FROZEN")).toBe(true);
    expect(isRuleEnabled("CONTRACT_ACTIVATED")).toBe(true);
    expect(isRuleEnabled("ALL_CONTRACTS_CLOSED")).toBe(true);
  });

  it("单条关闭", () => {
    mockEnv.CUSTOMER_AUTO_RULES_DISABLED = "INACTIVE_LOST";
    expect(isRuleEnabled("INACTIVE_LOST")).toBe(false);
    expect(isRuleEnabled("INACTIVE_FROZEN")).toBe(true);
  });

  it("多条关闭, 逗号分隔", () => {
    mockEnv.CUSTOMER_AUTO_RULES_DISABLED = "INACTIVE_LOST,INACTIVE_FROZEN";
    expect(isRuleEnabled("INACTIVE_LOST")).toBe(false);
    expect(isRuleEnabled("INACTIVE_FROZEN")).toBe(false);
    expect(isRuleEnabled("CONTRACT_ACTIVATED")).toBe(true);
  });

  it("带空白 trim", () => {
    mockEnv.CUSTOMER_AUTO_RULES_DISABLED = " INACTIVE_LOST , INACTIVE_FROZEN ";
    expect(isRuleEnabled("INACTIVE_LOST")).toBe(false);
    expect(isRuleEnabled("INACTIVE_FROZEN")).toBe(false);
    expect(isRuleEnabled("CONTRACT_ACTIVATED")).toBe(true);
  });

  it("未知 id 静默忽略 (不抛错, 不影响其他规则)", () => {
    mockEnv.CUSTOMER_AUTO_RULES_DISABLED = "INACTIVE_LOST,FOO_BAR,INACTIVE_FROZEN";
    expect(isRuleEnabled("INACTIVE_LOST")).toBe(false);
    expect(isRuleEnabled("INACTIVE_FROZEN")).toBe(false);
    expect(isRuleEnabled("CONTRACT_ACTIVATED")).toBe(true);
  });

  it("空 token (连续逗号 / 前后逗号) 静默忽略", () => {
    mockEnv.CUSTOMER_AUTO_RULES_DISABLED = ",,INACTIVE_LOST,,";
    expect(isRuleEnabled("INACTIVE_LOST")).toBe(false);
    expect(isRuleEnabled("CONTRACT_ACTIVATED")).toBe(true);
  });
});

describe("getTimeRules", () => {
  it("只返回 trigger=time 的 2 条规则", () => {
    const rs = getTimeRules();
    expect(rs).toHaveLength(2);
    expect(rs.map((r) => r.id).sort()).toEqual(["INACTIVE_FROZEN", "INACTIVE_LOST"].sort());
    for (const r of rs) expect(r.trigger).toBe("time");
  });
});

describe("getRuleLabel - 详情页横幅 label 兜底", () => {
  it("传入合法 rule id 命中 label", () => {
    expect(getRuleLabel("CONTRACT_ACTIVATED")).toBe("合同生效");
    expect(getRuleLabel("INACTIVE_LOST")).toBe("90 天无活动");
  });

  it("传入 null/undefined 返回「系统自动」兜底", () => {
    expect(getRuleLabel(null)).toBe("系统自动");
    expect(getRuleLabel(undefined)).toBe("系统自动");
    expect(getRuleLabel("")).toBe("系统自动");
  });

  it("传入未知 id 兜底为原 id 字符串", () => {
    expect(getRuleLabel("BOGUS_RULE")).toBe("BOGUS_RULE");
  });
});
