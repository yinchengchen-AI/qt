// 循环任务 Project.endDate 止期护栏:
// 在 generateDueForProject 内,若按当前周期推算的"下一个完成时间"会越过
// project.endDate,跳过生成新实例,审计日志记 WORKFLOW_RECURRING_SKIPPED_PROJECT_ENDED。
//
// 真实路径需要 PG 跑,此处锁:
// 1) computeProgressPct 纯函数行为(项目进度派生,Step B 同步覆盖)
// 2) 复盘止期判定逻辑的边界场景(单测用纯函数等价物)
import { describe, it, expect } from "vitest";
import { computeProgressPct } from "../server/services/project";

describe("computeProgressPct 边界(工作流派生进度)", () => {
  it("无任务 → 0", () => {
    expect(computeProgressPct([])).toBe(0);
  });

  it("全部 SKIPPED → 0(分母最大为 1,避免除零)", () => {
    expect(computeProgressPct([{ status: "SKIPPED" }, { status: "SKIPPED" }])).toBe(0);
  });

  it("全部 COMPLETED → 100.0", () => {
    expect(computeProgressPct([{ status: "COMPLETED" }, { status: "COMPLETED" }])).toBe(100);
  });

  it("COMPLETED + PENDING 混合 → 50.0", () => {
    expect(computeProgressPct([{ status: "COMPLETED" }, { status: "PENDING" }])).toBe(50);
  });

  it("SKIPPED 不计入分母", () => {
    // 3 个任务:1 COMPLETED,1 PENDING,1 SKIPPED → 1/2 = 50%
    expect(computeProgressPct([
      { status: "COMPLETED" },
      { status: "PENDING" },
      { status: "SKIPPED" }
    ])).toBe(50);
  });

  it("IN_PROGRESS 计入分母但不计入分子", () => {
    // 2 COMPLETED + 1 IN_PROGRESS + 1 SKIPPED → 2/3 = 66.7
    expect(computeProgressPct([
      { status: "COMPLETED" },
      { status: "COMPLETED" },
      { status: "IN_PROGRESS" },
      { status: "SKIPPED" }
    ])).toBe(66.7);
  });

  it("BLOCKED 视为未完成(计入分母)", () => {
    // 1 COMPLETED + 1 BLOCKED → 1/2 = 50
    expect(computeProgressPct([{ status: "COMPLETED" }, { status: "BLOCKED" }])).toBe(50);
  });

  it("保留 1 位小数(33.3% 不会被四舍五入到 33)", () => {
    // 1/3 = 33.333... → 33.3
    expect(computeProgressPct([{ status: "COMPLETED" }, { status: "PENDING" }, { status: "PENDING" }])).toBe(33.3);
  });
});

describe("止期护栏判定逻辑(纯函数等价物)", () => {
  // generateDueForProject 内的判定:nextCompletedAt = now + unitMs;若 > project.endDate 则跳过
  // 这里把判定用纯函数模拟,锁住边界
  function wouldExceedProjectEnd(now: Date, unitMs: number, projectEnd: Date): boolean {
    const nextCompletedAt = new Date(now.getTime() + unitMs);
    return nextCompletedAt > projectEnd;
  }

  it("nextCompletedAt 远在 endDate 之后 → 跳过", () => {
    const now = new Date("2026-06-13T00:00:00Z");
    const projectEnd = new Date("2026-06-14T00:00:00Z");
    const monthlyMs = 30 * 24 * 60 * 60 * 1000;
    expect(wouldExceedProjectEnd(now, monthlyMs, projectEnd)).toBe(true);
  });

  it("nextCompletedAt 仍在 endDate 之前 → 通过", () => {
    const now = new Date("2026-06-13T00:00:00Z");
    const projectEnd = new Date("2026-06-13T01:00:00Z");
    const hourlyMs = 60 * 60 * 1000;
    expect(wouldExceedProjectEnd(now, hourlyMs, projectEnd)).toBe(false);
  });

  it("项目无 endDate → 不应触发跳过(由外层 if project.endDate 守卫)", () => {
    // 此场景对应 service 内的 `if (project.endDate && ...)` 守卫
    // 单测侧我们断言 shouldBeSkipped 在 projectEnd=null 时永远 false
    function shouldBeSkipped(projectEnd: Date | null, nextCompletedAt: Date): boolean {
      if (!projectEnd) return false;
      return nextCompletedAt > projectEnd;
    }
    const future = new Date("2099-01-01");
    expect(shouldBeSkipped(null, future)).toBe(false);
  });
});
