// PR-1 锁:应用代码 (app/ components/ lib/ tests/) 不再引用死字段。
// 白名单只允许: 本测试 + lib/cleanup-blocklist.ts。
// PR-2 (schema 真删) 完成后,本测试 + 整个 blocklist 一并删除。
//
// 设计文档: docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md §6.1
import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

const DEPRECATED_GENERIC = [
  "requiresDeliverable", "requiresOnsite", "requiresTwoStepReview",
  "isRecurring", "recurrenceUnit", "recurrenceInterval", "estimateDays",
  "parentInstanceId", "reviewStatus", "reviewedById", "reviewedAt",
  "ProjectProgressLog",
];

const ALLOWLIST = new Set([
  "lib/cleanup-blocklist.ts",
  "tests/minimal-pm-workflow-blocklist.test.ts",
]);

function rgGeneric(): string {
  const pattern = DEPRECATED_GENERIC.join("|");
  try {
    return execSync(
      `rg -n --no-heading --regexp='\\b(${pattern})\\b' ` +
      `-g '*.ts' -g '*.tsx' ` +
      `-g '!node_modules' -g '!.next' -g '!docs' ` +
      `-g '!lib/cleanup-blocklist.ts' ` +
      `-g '!tests/minimal-pm-workflow-blocklist.test.ts' ` +
      `-g '!app/api/invoices/**' -g '!prisma/migrations/**' ` +
      `app components lib tests`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (e: unknown) {
    return (e as { stdout?: string })?.stdout ?? "";
  }
}

function rgAttachments(): string {
  try {
    return execSync(
      `rg -n --no-heading -P ` +
      `'task\\\\.attachments|instance\\\\.attachments|` +
      `workflow-tasks/[a-zA-Z0-9_\\\\-\\\\[\\\\]]+/attachments' ` +
      `-g '*.ts' -g '*.tsx' ` +
      `-g '!node_modules' -g '!.next' -g '!docs' ` +
      `-g '!lib/cleanup-blocklist.ts' ` +
      `-g '!tests/minimal-pm-workflow-blocklist.test.ts' ` +
      `app components lib tests`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (e: unknown) {
    return (e as { stdout?: string })?.stdout ?? "";
  }
}

describe("PR-1 DEPRECATED_FIELDS 代码层清理", () => {
  it("DEPRECATED_GENERIC 名单为冻结顺序,与预期一致", () => {
    expect([...DEPRECATED_GENERIC]).toEqual([
      "requiresDeliverable", "requiresOnsite", "requiresTwoStepReview",
      "isRecurring", "recurrenceUnit", "recurrenceInterval", "estimateDays",
      "parentInstanceId", "reviewStatus", "reviewedById", "reviewedAt",
      "ProjectProgressLog",
    ]);
  });

  it("应用代码不应再含 11 个通用死字段的引用", () => {
    const out = rgGeneric();
    const lines = out.trim().split("\n").filter(Boolean);
    const offenders = lines
      .map((line) => line.split(":")[0])
      .filter((p) => p && !ALLOWLIST.has(p));
    expect(offenders, `死字段仍有非白名单引用:\n${out}`).toEqual([]);
    expect(lines.length).toBe(0);
  });

  it("应用代码不应再引用 WorkflowTaskInstance.attachments (精确扫描)", () => {
    const out = rgAttachments();
    const lines = out.trim().split("\n").filter(Boolean);
    const offenders = lines
      .map((line) => line.split(":")[0])
      .filter((p) => p && !ALLOWLIST.has(p));
    expect(offenders, `WorkflowTaskInstance.attachments 仍有非白名单引用:\n${out}`).toEqual([]);
    expect(lines.length).toBe(0);
  });
});
