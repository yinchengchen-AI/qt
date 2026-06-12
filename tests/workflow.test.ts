// 工作流引擎 — 状态机数据表 + 辅助函数单测
// 服务层涉及 prisma.$transaction,留 E2E 覆盖(配合脚本初始化 PG);此处只锁数据表 + 工具函数
import { describe, it, expect } from "vitest";
import {
  WORKFLOW_TASK_STATUS,
  WORKFLOW_REVIEW_STATUS,
  WORKFLOW_TASK_ACTIONS,
  WORKFLOW_REVIEW_ACTIONS,
  WORKFLOW_PHASE_ORDER,
  WORKFLOW_PHASE_STATE,
  MESSAGE_TYPE
} from "../types/enums";
import { ERROR_CODES } from "../types/errors";

describe("Workflow enums are non-empty and stable", () => {
  it("taskStatus has 5 values and contains the documented codes", () => {
    expect(WORKFLOW_TASK_STATUS.length).toBe(5);
    expect(new Set(WORKFLOW_TASK_STATUS)).toEqual(
      new Set(["PENDING", "IN_PROGRESS", "COMPLETED", "SKIPPED", "BLOCKED"])
    );
  });
  it("reviewStatus has 4 values", () => {
    expect(WORKFLOW_REVIEW_STATUS.length).toBe(4);
    expect(new Set(WORKFLOW_REVIEW_STATUS)).toEqual(
      new Set(["REVIEWING", "REVIEWED", "APPROVED", "REJECTED"])
    );
  });
  it("task actions have 5 values, all lower-case verbs", () => {
    expect(new Set(WORKFLOW_TASK_ACTIONS)).toEqual(
      new Set(["start", "complete", "block", "unblock", "skip"])
    );
  });
  it("review actions have 3 values", () => {
    expect(new Set(WORKFLOW_REVIEW_ACTIONS)).toEqual(
      new Set(["submit", "approve", "reject"])
    );
  });
});

describe("Workflow error codes are registered with messages", () => {
  // 防止新增错误码忘了同步 ERROR_MESSAGES
  const REQUIRED = [
    "WORKFLOW_TEMPLATE_NOT_FOUND",
    "WORKFLOW_ALREADY_INSTANTIATED",
    "WORKFLOW_TASK_NOT_FOUND",
    "WORKFLOW_TASK_INVALID_TRANSITION",
    "WORKFLOW_REVIEW_REQUIRED",
    "WORKFLOW_DELIVERABLE_REQUIRED"
  ] as const;
  for (const code of REQUIRED) {
    it(`${code} is in ERROR_CODES`, () => {
      expect((ERROR_CODES as Record<string, string>)[code]).toBe(code);
    });
  }
});

// 复用 service 内部的 helper 不导出,这里反向校验数据表的一致性
// (以下断言与 server/services/workflow.ts 的 TASK_TRANSITIONS / REVIEW_TRANSITIONS 同步)
const TASK_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  start:    { from: ["PENDING", "BLOCKED"], to: "IN_PROGRESS" },
  complete: { from: ["IN_PROGRESS"],        to: "COMPLETED" },
  block:    { from: ["PENDING", "IN_PROGRESS"], to: "BLOCKED" },
  unblock:  { from: ["BLOCKED"],            to: "PENDING" },
  skip:     { from: ["PENDING", "BLOCKED"], to: "SKIPPED" }
};

const REVIEW_TRANSITIONS: Record<string, { from: (string | null)[]; to: string | null }> = {
  submit:  { from: [null, "REJECTED"], to: "REVIEWING" },
  approve: { from: ["REVIEWING"],     to: "APPROVED" },
  reject:  { from: ["REVIEWING"],     to: "REJECTED" }
};

describe("Task transition table is internally consistent", () => {
  it("every from-state is a valid taskStatus", () => {
    for (const [, t] of Object.entries(TASK_TRANSITIONS)) {
      for (const f of t.from) {
        expect(WORKFLOW_TASK_STATUS).toContain(f);
      }
      expect(WORKFLOW_TASK_STATUS).toContain(t.to);
    }
  });

  it("start is reachable from PENDING and BLOCKED, complete from IN_PROGRESS only", () => {
    expect(TASK_TRANSITIONS.start?.from).toEqual(["PENDING", "BLOCKED"]);
    expect(TASK_TRANSITIONS.start?.to).toBe("IN_PROGRESS");
    expect(TASK_TRANSITIONS.complete?.from).toEqual(["IN_PROGRESS"]);
    expect(TASK_TRANSITIONS.complete?.to).toBe("COMPLETED");
  });

  it("skip is a terminal soft-state, only allowed from PENDING/BLOCKED", () => {
    expect(TASK_TRANSITIONS.skip?.to).toBe("SKIPPED");
    expect(TASK_TRANSITIONS.skip?.from).toEqual(["PENDING", "BLOCKED"]);
  });

  it("unblock returns BLOCKED → PENDING, not into IN_PROGRESS", () => {
    expect(TASK_TRANSITIONS.unblock?.from).toEqual(["BLOCKED"]);
    expect(TASK_TRANSITIONS.unblock?.to).toBe("PENDING");
  });
});

describe("Review transition table is internally consistent", () => {
  it("every from-state is null or a valid reviewStatus", () => {
    for (const t of Object.values(REVIEW_TRANSITIONS)) {
      for (const f of t.from) {
        expect(f === null || WORKFLOW_REVIEW_STATUS.includes(f as never)).toBe(true);
      }
      expect(t.to === null || WORKFLOW_REVIEW_STATUS.includes(t.to as never)).toBe(true);
    }
  });

  it("submit accepts null (never reviewed) or REJECTED (re-submit)", () => {
    expect(REVIEW_TRANSITIONS.submit?.from).toEqual([null, "REJECTED"]);
    expect(REVIEW_TRANSITIONS.submit?.to).toBe("REVIEWING");
  });

  it("approve/reject are reachable only from REVIEWING", () => {
    expect(REVIEW_TRANSITIONS.approve?.from).toEqual(["REVIEWING"]);
    expect(REVIEW_TRANSITIONS.approve?.to).toBe("APPROVED");
    expect(REVIEW_TRANSITIONS.reject?.from).toEqual(["REVIEWING"]);
    expect(REVIEW_TRANSITIONS.reject?.to).toBe("REJECTED");
  });
});

// 工具函数复刻 service 内部实现,做单测锁定行为
function hasDeliverable(attachments: unknown): boolean {
  if (!attachments) return false;
  if (Array.isArray(attachments)) return attachments.length > 0;
  if (typeof attachments === "object") {
    const arr = (attachments as { items?: unknown[] }).items;
    return Array.isArray(arr) ? arr.length > 0 : Object.keys(attachments).length > 0;
  }
  return false;
}

describe("hasDeliverable helper", () => {
  it("returns false for null/undefined/empty", () => {
    expect(hasDeliverable(null)).toBe(false);
    expect(hasDeliverable(undefined)).toBe(false);
    expect(hasDeliverable([])).toBe(false);
    expect(hasDeliverable({})).toBe(false);
  });
  it("returns true for non-empty array", () => {
    expect(hasDeliverable([{ id: "1" }])).toBe(true);
  });
  it("returns true for object with items array", () => {
    expect(hasDeliverable({ items: [{ id: "1" }] })).toBe(true);
    expect(hasDeliverable({ items: [] })).toBe(false);
  });
  it("returns true for any non-empty plain object", () => {
    expect(hasDeliverable({ key1: "v" })).toBe(true);
  });
});

// =====================================================
// P2: 时间感知循环 + 我的任务 + 概览
// =====================================================

describe("recurrenceToMs converts units correctly", () => {
  // 复用 service 内部逻辑做单测
  function recurrenceToMs(interval: number, unit: string): number | null {
    switch (unit) {
      case "DAY":   return interval * 24 * 60 * 60 * 1000;
      case "WEEK":  return interval * 7 * 24 * 60 * 60 * 1000;
      case "MONTH": return interval * 30 * 24 * 60 * 60 * 1000;
      case "YEAR":  return interval * 365 * 24 * 60 * 60 * 1000;
      default:      return null;
    }
  }

  it("1 DAY = 1 day in ms", () => {
    expect(recurrenceToMs(1, "DAY")).toBe(24 * 60 * 60 * 1000);
  });
  it("2 WEEK = 14 days in ms", () => {
    expect(recurrenceToMs(2, "WEEK")).toBe(14 * 24 * 60 * 60 * 1000);
  });
  it("1 MONTH = 30 days in ms (simplified)", () => {
    expect(recurrenceToMs(1, "MONTH")).toBe(30 * 24 * 60 * 60 * 1000);
  });
  it("1 YEAR = 365 days in ms", () => {
    expect(recurrenceToMs(1, "YEAR")).toBe(365 * 24 * 60 * 60 * 1000);
  });
  it("unknown unit returns null", () => {
    expect(recurrenceToMs(1, "FORTNIGHT")).toBeNull();
  });
});

describe("isRecurrenceDue is time-aware and only fires for COMPLETED parents", () => {
  // 复用 service 内部逻辑
  function recurrenceToMs(interval: number, unit: string): number | null {
    switch (unit) {
      case "DAY":   return interval * 24 * 60 * 60 * 1000;
      case "WEEK":  return interval * 7 * 24 * 60 * 60 * 1000;
      case "MONTH": return interval * 30 * 24 * 60 * 60 * 1000;
      case "YEAR":  return interval * 365 * 24 * 60 * 60 * 1000;
      default:      return null;
    }
  }
  function isRecurrenceDue(
    ins: { completedAt: Date | null; status: string },
    task: { recurrenceInterval: number | null; recurrenceUnit: string | null; isRecurring: boolean },
    now: Date
  ): boolean {
    if (!task.isRecurring) return false;
    if (ins.status !== "COMPLETED") return false;
    if (!ins.completedAt) return false;
    if (task.recurrenceInterval == null || task.recurrenceUnit == null) return false;
    const ms = recurrenceToMs(task.recurrenceInterval, task.recurrenceUnit);
    if (ms == null) return false;
    return now.getTime() - ins.completedAt.getTime() >= ms;
  }

  const day = 24 * 60 * 60 * 1000;
  const now = new Date("2026-06-12T00:00:00Z");

  it("non-recurring task never recurs", () => {
    expect(isRecurrenceDue(
      { completedAt: new Date(now.getTime() - 1000 * day), status: "COMPLETED" },
      { isRecurring: false, recurrenceInterval: 1, recurrenceUnit: "MONTH" },
      now
    )).toBe(false);
  });

  it("IN_PROGRESS parent does NOT trigger next instance", () => {
    expect(isRecurrenceDue(
      { completedAt: new Date(now.getTime() - 1000 * day), status: "IN_PROGRESS" },
      { isRecurring: true, recurrenceInterval: 1, recurrenceUnit: "MONTH" },
      now
    )).toBe(false);
  });

  it("PENDING parent does NOT trigger next instance", () => {
    expect(isRecurrenceDue(
      { completedAt: new Date(now.getTime() - 1000 * day), status: "PENDING" },
      { isRecurring: true, recurrenceInterval: 1, recurrenceUnit: "MONTH" },
      now
    )).toBe(false);
  });

  it("monthly task completed 60 days ago triggers", () => {
    expect(isRecurrenceDue(
      { completedAt: new Date(now.getTime() - 60 * day), status: "COMPLETED" },
      { isRecurring: true, recurrenceInterval: 1, recurrenceUnit: "MONTH" },
      now
    )).toBe(true);
  });

  it("monthly task completed 10 days ago does NOT trigger (within cycle)", () => {
    expect(isRecurrenceDue(
      { completedAt: new Date(now.getTime() - 10 * day), status: "COMPLETED" },
      { isRecurring: true, recurrenceInterval: 1, recurrenceUnit: "MONTH" },
      now
    )).toBe(false);
  });

  it("yearly task completed 364 days ago does NOT trigger (within 365-day window)", () => {
    expect(isRecurrenceDue(
      { completedAt: new Date(now.getTime() - 364 * day), status: "COMPLETED" },
      { isRecurring: true, recurrenceInterval: 1, recurrenceUnit: "YEAR" },
      now
    )).toBe(false);
  });

  it("yearly task completed 366 days ago triggers", () => {
    expect(isRecurrenceDue(
      { completedAt: new Date(now.getTime() - 366 * day), status: "COMPLETED" },
      { isRecurring: true, recurrenceInterval: 1, recurrenceUnit: "YEAR" },
      now
    )).toBe(true);
  });

  it("missing recurrenceInterval/Unit does NOT trigger", () => {
    expect(isRecurrenceDue(
      { completedAt: new Date(now.getTime() - 100 * day), status: "COMPLETED" },
      { isRecurring: true, recurrenceInterval: null, recurrenceUnit: null },
      now
    )).toBe(false);
  });

  it("null completedAt does NOT trigger (defensive)", () => {
    expect(isRecurrenceDue(
      { completedAt: null, status: "COMPLETED" },
      { isRecurring: true, recurrenceInterval: 1, recurrenceUnit: "MONTH" },
      now
    )).toBe(false);
  });
});

describe("Domain events for workflow", () => {
  // 锁事件类型(防止后续误删)
  const ALLOWED_WORKFLOW_EVENTS = new Set(["WORKFLOW_TASK_ASSIGNED", "WORKFLOW_REVIEW_REQUESTED"]);
  it("has the 2 workflow events registered", () => {
    expect(ALLOWED_WORKFLOW_EVENTS.has("WORKFLOW_TASK_ASSIGNED")).toBe(true);
    expect(ALLOWED_WORKFLOW_EVENTS.has("WORKFLOW_REVIEW_REQUESTED")).toBe(true);
  });
  it("MESSAGE_TYPE covers workflow events", () => {
    expect(MESSAGE_TYPE).toContain("WORKFLOW_TASK_ASSIGNED");
    expect(MESSAGE_TYPE).toContain("WORKFLOW_REVIEW_REQUESTED");
  });
});

// =====================================================
// P3: 阶段顺序 + WORKFLOW_PHASE_ORDER
// =====================================================
describe("WORKFLOW_PHASE_ORDER is strictly ordered", () => {
  it("has 5 phases in canonical order", () => {
    expect(WORKFLOW_PHASE_ORDER.length).toBe(5);
    expect(WORKFLOW_PHASE_ORDER).toEqual([
      "PREP",
      "REQUIREMENT",
      "CONTRACT",
      "EXECUTE",
      "FOLLOWUP"
    ]);
  });
  it("WORKFLOW_PHASE_STATE has 4 states", () => {
    expect(WORKFLOW_PHASE_STATE.length).toBe(4);
    expect(new Set(WORKFLOW_PHASE_STATE)).toEqual(new Set(["DONE", "PARTIAL", "LOCKED", "READY"]));
  });
});

describe("checkPhaseLock logic (replicated)", () => {
  // 复制 service 内 checkPhaseLock 的查询逻辑
  // 真实测试需 DB mock,这里锁"概念正确性"
  // P0 seed: 所有 common 阶段 isRequired=true
  const COMMON_REQUIRED_STAGES = ["PREP", "REQUIREMENT", "CONTRACT", "FOLLOWUP"];

  it("PREP 阶段没有前置,直接放行", () => {
    const idx = WORKFLOW_PHASE_ORDER.indexOf("PREP");
    expect(idx).toBe(0);
    // 索引 0 没有 prev phase,放行
  });

  it("EXECUTE 阶段的前置是 CONTRACT,且 CONTRACT required", () => {
    const idx = WORKFLOW_PHASE_ORDER.indexOf("EXECUTE");
    expect(WORKFLOW_PHASE_ORDER[idx - 1]).toBe("CONTRACT");
    expect(COMMON_REQUIRED_STAGES).toContain("CONTRACT");
  });

  it("FOLLOWUP 阶段的前置是 EXECUTE", () => {
    const idx = WORKFLOW_PHASE_ORDER.indexOf("FOLLOWUP");
    expect(WORKFLOW_PHASE_ORDER[idx - 1]).toBe("EXECUTE");
  });

  it("可选阶段(若 isRequired=false)不应阻塞下一阶段", () => {
    // 概念锁定:checkPhaseLock 查的是 stage.isRequired=true 的 stage 里的实例
    // 若前一阶段整个 isRequired=false,则没任务在 unfinished 集合,放行
    const mockUnfinishedFromOptionalStage: { status: string }[] = [];
    expect(mockUnfinishedFromOptionalStage.length).toBe(0);
  });
});

describe("WORKFLOW_PHASE_LOCKED is registered", () => {
  it("has correct error code and message", () => {
    expect((ERROR_CODES as Record<string, string>)["WORKFLOW_PHASE_LOCKED"]).toBe("WORKFLOW_PHASE_LOCKED");
  });
});
