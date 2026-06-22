// 客户状态机迁移表测试
//
// 覆盖矩阵 (PLAN 客户状态机优化 §Test Plan):
//   1) 所有出现在表里的正向边 assertCanTransition 不抛
//   2) 所有不在表里的负向边抛 CUSTOMER_STATUS_TRANSITION_INVALID
//   3) getAllowedTransitions 输出与表一致, LOST/FROZEN 自循环不出现
//   4) LEAD→FROZEN、LOST→LOST 等典型非法路径被拒
//   5) isCustomerStatus 正确识别合法/非法字符串
import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { CUSTOMER_STATUS, type CustomerStatus } from "@/types/enums";
import {
  CUSTOMER_STATUS_TRANSITIONS,
  getAllowedTransitions,
  getDisallowedTransitions,
  isCustomerStatus
} from "@/lib/customer-status-transitions";
import { assertCanTransition } from "@/server/services/customer-status";

describe("CUSTOMER_STATUS_TRANSITIONS 静态表", () => {
  it("5 个状态都有定义", () => {
    expect(Object.keys(CUSTOMER_STATUS_TRANSITIONS).sort()).toEqual([...CUSTOMER_STATUS].sort());
  });

  it("LEAD: 可去往 NEGOTIATING/SIGNED/LOST, 不可去往 FROZEN", () => {
    expect(CUSTOMER_STATUS_TRANSITIONS.LEAD).toEqual(["NEGOTIATING", "SIGNED", "LOST"]);
    expect(CUSTOMER_STATUS_TRANSITIONS.LEAD).not.toContain("FROZEN");
  });

  it("NEGOTIATING: 可去往 SIGNED/LOST/FROZEN", () => {
    expect(CUSTOMER_STATUS_TRANSITIONS.NEGOTIATING).toEqual(["SIGNED", "LOST", "FROZEN"]);
  });

  it("SIGNED: 可去往 LOST/FROZEN, 不可去往 LEAD/NEGOTIATING (越级)", () => {
    expect(CUSTOMER_STATUS_TRANSITIONS.SIGNED).toEqual(["LOST", "FROZEN"]);
    expect(CUSTOMER_STATUS_TRANSITIONS.SIGNED).not.toContain("LEAD");
    expect(CUSTOMER_STATUS_TRANSITIONS.SIGNED).not.toContain("NEGOTIATING");
  });

  it("LOST: 仅可去往 NEGOTIATING (恢复推进), 不自循环", () => {
    expect(CUSTOMER_STATUS_TRANSITIONS.LOST).toEqual(["NEGOTIATING"]);
    expect(CUSTOMER_STATUS_TRANSITIONS.LOST).not.toContain("LOST");
  });

  it("FROZEN: 仅可去往 NEGOTIATING (恢复推进), 不自循环", () => {
    expect(CUSTOMER_STATUS_TRANSITIONS.FROZEN).toEqual(["NEGOTIATING"]);
    expect(CUSTOMER_STATUS_TRANSITIONS.FROZEN).not.toContain("FROZEN");
  });

  it("LOST/FROZEN 自循环不在表内", () => {
    for (const s of ["LEAD", "NEGOTIATING", "SIGNED", "LOST", "FROZEN"] as CustomerStatus[]) {
      expect(CUSTOMER_STATUS_TRANSITIONS[s]).not.toContain(s);
    }
  });
});

describe("getAllowedTransitions", () => {
  it("输出与表一致", () => {
    for (const from of CUSTOMER_STATUS) {
      expect(getAllowedTransitions(from)).toEqual(CUSTOMER_STATUS_TRANSITIONS[from]);
    }
  });

  it("LOST 不可去往 LOST 自身", () => {
    expect(getAllowedTransitions("LOST")).not.toContain("LOST");
  });

  it("FROZEN 不可去往 FROZEN 自身", () => {
    expect(getAllowedTransitions("FROZEN")).not.toContain("FROZEN");
  });

  it("LEAD 不可直接去往 FROZEN", () => {
    expect(getAllowedTransitions("LEAD")).not.toContain("FROZEN");
  });
});

describe("getDisallowedTransitions", () => {
  it("返回所有不在表内的目标", () => {
    const disallowed = getDisallowedTransitions("LEAD");
    expect(disallowed).toContain("FROZEN");
    expect(disallowed).not.toContain("NEGOTIATING");
    expect(disallowed).not.toContain("SIGNED");
    expect(disallowed).not.toContain("LOST");
  });

  it("SIGNED 的 disallowed 应包含 LEAD (越级回退)", () => {
    expect(getDisallowedTransitions("SIGNED")).toContain("LEAD");
  });
});

describe("isCustomerStatus", () => {
  it("合法状态返回 true", () => {
    for (const s of CUSTOMER_STATUS) {
      expect(isCustomerStatus(s)).toBe(true);
    }
  });

  it("非法字符串返回 false", () => {
    expect(isCustomerStatus("BOGUS")).toBe(false);
    expect(isCustomerStatus("signed")).toBe(false); // 大小写敏感
    expect(isCustomerStatus("")).toBe(false);
    expect(isCustomerStatus(null)).toBe(false);
    expect(isCustomerStatus(undefined)).toBe(false);
    expect(isCustomerStatus(123)).toBe(false);
  });
});

describe("assertCanTransition", () => {
  it("正向迁移: LEAD → SIGNED 不抛", () => {
    expect(() => assertCanTransition("LEAD", "SIGNED")).not.toThrow();
  });

  it("正向迁移: NEGOTIATING → FROZEN 不抛", () => {
    expect(() => assertCanTransition("NEGOTIATING", "FROZEN")).not.toThrow();
  });

  it("正向迁移: SIGNED → FROZEN 不抛", () => {
    expect(() => assertCanTransition("SIGNED", "FROZEN")).not.toThrow();
  });

  it("正向迁移: LOST → NEGOTIATING 不抛 (终态恢复)", () => {
    expect(() => assertCanTransition("LOST", "NEGOTIATING")).not.toThrow();
  });

  it("正向迁移: FROZEN → NEGOTIATING 不抛 (终态恢复)", () => {
    expect(() => assertCanTransition("FROZEN", "NEGOTIATING")).not.toThrow();
  });

  it("负向迁移: SIGNED → LEAD 抛 ApiError", () => {
    try {
      assertCanTransition("SIGNED", "LEAD");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.errorCode).toBe(ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID);
      expect(err.status).toBe(422);
      expect(err.message).toContain("SIGNED");
      expect(err.message).toContain("LEAD");
    }
  });

  it("负向迁移: LEAD → FROZEN 抛 ApiError (产品规则不允许)", () => {
    try {
      assertCanTransition("LEAD", "FROZEN");
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).errorCode).toBe(ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID);
    }
  });

  it("负向迁移: LOST → LOST 抛 ApiError (自循环)", () => {
    try {
      assertCanTransition("LOST", "LOST");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ApiError).errorCode).toBe(ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID);
    }
  });

  it("负向迁移: FROZEN → FROZEN 抛 ApiError (自循环)", () => {
    expect(() => assertCanTransition("FROZEN", "FROZEN")).toThrowError(ApiError);
  });

  it("负向迁移: NEGOTIATING → NEGOTIATING 抛 ApiError (noop 写入绕过审计防御)", () => {
    expect(() => assertCanTransition("NEGOTIATING", "NEGOTIATING")).toThrowError(ApiError);
  });

  it("非法目标字符串: LEAD → 'BOGUS' 抛 ApiError", () => {
    try {
      assertCanTransition("LEAD", "BOGUS");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ApiError).errorCode).toBe(ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID);
    }
  });
});
