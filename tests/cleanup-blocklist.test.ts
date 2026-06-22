// PR-1 锁: 应用代码 (app/ components/ lib/) 不再引用死字段.
// 例外只允许:
//   1) lib/cleanup-blocklist.ts (本白名单定义)
//   2) 本测试文件
// PR-2 完成后, 把 schema 改完, 本测试 + 整个 blocklist 一并删除.
//
// 设计文档: docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md §6.1
import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { DEPRECATED_FIELDS, buildDeprecatedFieldPattern } from "../lib/cleanup-blocklist";

const ALLOWLIST = new Set<string>([
  "lib/cleanup-blocklist.ts",
  "tests/cleanup-blocklist.test.ts",
]);

function grep(): string {
  // 走 rg 原生 regex (Rust regex), 不加 -E. 扫 .ts/.tsx,
  // 排除 node_modules / .next / docs (docs 是设计文档, 故意保留字段名引用).
  const pattern = buildDeprecatedFieldPattern();
  try {
    return execSync(
      `rg -n --no-heading '${pattern}' -g '*.ts' -g '*.tsx' -g '!node_modules' -g '!.next' -g '!docs' app components lib tests | grep -v '^tests/cleanup-blocklist.test.ts:' | grep -v '^lib/cleanup-blocklist.ts:' || true`,
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e: unknown) {
    // rg 返回非 0 (有命中) 也会进 catch; 这里用 stdout 而非 exit code 判断
    return (e as { stdout?: string })?.stdout ?? "";
  }
}

describe("Project+Workflow 最简化 — 死字段清理 (PR-1)", () => {
  it("DEPRECATED_FIELDS 是冻结数组, 不应为空", () => {
    expect(DEPRECATED_FIELDS.length).toBeGreaterThan(0);
    // 锁定顺序 + 内容, 避免后续 PR 中误删
    expect([...DEPRECATED_FIELDS]).toEqual([
      "requiresDeliverable",
      "requiresOnsite",
      "requiresTwoStepReview",
      "isRecurring",
      "recurrenceUnit",
      "recurrenceInterval",
      "estimateDays",
      "parentInstanceId",
      "reviewStatus",
      "reviewedById",
      "reviewedAt",
      "attachments",
      "ProjectProgressLog",
    ]);
  });

  it("buildDeprecatedFieldPattern 输出有效的 alternation", () => {
    const p = buildDeprecatedFieldPattern();
    expect(p).toContain("requiresDeliverable");
    expect(p).toContain("ProjectProgressLog");
    expect(p.split("|")).toHaveLength(DEPRECATED_FIELDS.length);
  });

  it("app/components/lib (除白名单外) 不应再出现死字段", () => {
    const out = grep();
    if (out.trim() !== "") {
      const offenders = out
        .trim()
        .split("\n")
        .map((line) => line.split(":")[0])
        .filter((p) => p && !ALLOWLIST.has(p));
      expect(
        offenders,
        `死字段仍有非白名单引用:\n${out}`,
      ).toEqual([]);
    }
    expect(out.trim()).toBe("");
  });
});
