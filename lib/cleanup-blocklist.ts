// Project + Workflow 最简化 (乙档) — PR-1 期间, 死字段白名单.
// PR-2 (schema 真删) 完成后此文件删除, 单测随之删除.
//
// 设计文档: docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md
// §2.1 / §2.2 / §3.1 / §6.1
//
// 注: `attachments` 不在此列 — 它在 Asset / Contract / Invoice 上是合法字段.
//     死的是 `WorkflowTaskInstance.attachments` (Json) 这一处, 单独在
//     `tests/workflow-instance-attachments.test.ts` 精确测.
export const DEPRECATED_FIELDS = [
  // WorkflowTask
  "requiresDeliverable",
  "requiresOnsite",
  "requiresTwoStepReview",
  "isRecurring",
  "recurrenceUnit",
  "recurrenceInterval",
  "estimateDays",
  // WorkflowTaskInstance
  "parentInstanceId",
  "reviewStatus",
  "reviewedById",
  "reviewedAt",
  // 表
  "ProjectProgressLog",
] as const;

export type DeprecatedField = (typeof DEPRECATED_FIELDS)[number];

/**
 * 构造用于 `rg` 的 alternation pattern. 单测与 CI 脚本都用此函数,
 * 避免分散维护两套字面量导致漏检.
 */
export function buildDeprecatedFieldPattern(): string {
  return DEPRECATED_FIELDS.map((f) =>
    f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  ).join("|");
}
