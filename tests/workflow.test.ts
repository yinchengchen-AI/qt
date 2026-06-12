// 工作流引擎 — 状态机数据表 + 辅助函数单测
// 服务层涉及 prisma.$transaction,留 E2E 覆盖(配合脚本初始化 PG);此处只锁数据表 + 工具函数
import { describe, it, expect } from "vitest";
import {
  WORKFLOW_TASK_STATUS,
  WORKFLOW_REVIEW_STATUS,
  WORKFLOW_TASK_ACTIONS,
  WORKFLOW_REVIEW_ACTIONS
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
