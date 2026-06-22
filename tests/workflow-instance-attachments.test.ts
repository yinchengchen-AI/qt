// PR-1 锁: WorkflowTaskInstance.attachments (Json) 死字段在应用代码中不再被引用.
// 范围: task.attachments / WorkflowTaskInstance.*attachments / 关联 API 路径
// 与 `tests/cleanup-blocklist.test.ts` 互补, 处理"通用名 attachments 在其它模型上合法"
// 这种无法靠广撒字符串检测的情况.
//
// 设计文档: docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md §2.2
import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

// 这些文件仍可能引用 task-instance.attachments 的占位/历史, PR-1 收尾前必须改完.
// 一旦 PR-1.21 通过, 这里应清空.
const ALLOWLIST = new Set<string>([
  // blocklist 自身 + 本测试
  "lib/cleanup-blocklist.ts",
  "tests/cleanup-blocklist.test.ts",
  "tests/workflow-instance-attachments.test.ts",
]);

const PATTERNS = [
  // 1. task/instance 上的 .attachments 字段访问
  "task\\.attachments",
  "instance\\.attachments",
  // 2. WorkflowTaskInstance 类型上的 attachments 字段声明
  "WorkflowTaskInstance[^\\n]*attachments",
  // 3. 旧 task-attachment API 路径
  "workflow-tasks/[a-zA-Z0-9_\\-\\[]+/attachments",
];

function grep(): string {
  const combined = PATTERNS.join("|");
  try {
    return execSync(
      `rg -n --no-heading -P '${combined}' -g '*.ts' -g '*.tsx' -g '!node_modules' -g '!.next' -g '!docs' -g '!lib/cleanup-blocklist.ts' -g '!tests/cleanup-blocklist.test.ts' -g '!tests/workflow-instance-attachments.test.ts' app components lib tests || true`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e: unknown) {
    return (e as { stdout?: string })?.stdout ?? "";
  }
}

describe("WorkflowTaskInstance.attachments 死字段清理 (PR-1)", () => {
  it("app/components/lib (除白名单外) 不应再引用 task-instance.attachments", () => {
    const out = grep();
    if (out.trim() !== "") {
      const offenders = out
        .trim()
        .split("\n")
        .map((line) => line.split(":")[0])
        .filter((p) => p && !ALLOWLIST.has(p));
      expect(
        offenders,
        `WorkflowTaskInstance.attachments 仍有非白名单引用:\n${out}`,
      ).toEqual([]);
    }
    expect(out.trim()).toBe("");
  });
});
