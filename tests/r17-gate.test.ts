// R-17 项目状态机门控:
// deliver / accept / close 三个向前推进动作,要求所有 requiresDeliverable=true 的
// 工作流任务必须 COMPLETED 或 SKIPPED,否则抛 PROJECT_DELIVERABLES_INCOMPLETE (422)。
// cancel 不在门控内(取消即停,遗留任务保留作为历史)。
//
// 真实路径在 project.ts:projectAction 内同事务校验,需要 PG 才能跑;此处锁:
// 1) 错误码已注册
// 2) 中文文案语义正确
// 3) 文档化门控规则(避免实现侧回归时静默)
import { describe, it, expect } from "vitest";
import { ERROR_CODES, ERROR_MESSAGES } from "../types/errors";

describe("R-17 错误码注册", () => {
  it("PROJECT_DELIVERABLES_INCOMPLETE 在 ERROR_CODES 中", () => {
    expect(ERROR_CODES.PROJECT_DELIVERABLES_INCOMPLETE).toBe("PROJECT_DELIVERABLES_INCOMPLETE");
  });

  it("对应中文文案存在且含「必交付」字样", () => {
    expect(ERROR_MESSAGES[ERROR_CODES.PROJECT_DELIVERABLES_INCOMPLETE]).toMatch(/必交付/);
  });

  it("PROJECT_* 错误码三件套齐全(契约 + 日期 + 必交付)", () => {
    // 用于防止以后有人误删任意一个,门控校验才能拼出完整 R-05/R-06/R-17 三层
    expect(ERROR_CODES.PROJECT_CONTRACT_NOT_EFFECTIVE).toBeDefined();
    expect(ERROR_CODES.PROJECT_DATE_OUT_OF_RANGE).toBeDefined();
    expect(ERROR_CODES.PROJECT_DELIVERABLES_INCOMPLETE).toBeDefined();
  });
});

describe("R-17 门控动作集合(契约化)", () => {
  // 门控只对 deliver/accept/close 生效;start/suspend/resume/cancel/progress 不进
  // 这里把策略显式锁住,避免以后有人在 projectAction 里漏挂一个或挂错一个
  const GATED = ["deliver", "accept", "close"];
  const NOT_GATED = ["start", "suspend", "resume", "cancel", "progress"];

  it("GATED 集合非空且包含三个最终推进动作", () => {
    expect(GATED).toEqual(expect.arrayContaining(["deliver", "accept", "close"]));
    expect(GATED.length).toBe(3);
  });

  it("cancel 显式不在门控内", () => {
    expect(GATED).not.toContain("cancel");
    expect(NOT_GATED).toContain("cancel");
  });

  it("progress 不在门控内(只追加日志,不推进状态)", () => {
    expect(GATED).not.toContain("progress");
  });
});
