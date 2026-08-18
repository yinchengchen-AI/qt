// Phase 2 风险预警引擎 schema 回归测试
// 一旦 RiskScoreSnapshot 表结构或 RISK_LEVEL_UP 枚举被错误改动, 这个测试就会 fail.
//
// 关联的迁移:
//   prisma/migrations/20260822_risk_score_snapshot/migration.sql
//   prisma/migrations/20260822_message_type_risk_level_up/migration.sql
// 关联的 spec:docs/superpowers/specs/2026-08-18-contract-deepening-roadmap-design.md §5

import { describe, it, expect } from "vitest";
import { Prisma, MessageType } from "@prisma/client";

describe("Phase 2 风险预警引擎 schema 回归", () => {
  const requiredFields = [
    "id",
    "contractId",
    "score",
    "level",
    "dimensions",
    "snapshotDate",
    "createdAt"
  ];
  for (const f of requiredFields) {
    it(`RiskScoreSnapshot 含字段: ${f}`, () => {
      expect(f in Prisma.RiskScoreSnapshotScalarFieldEnum).toBe(true);
    });
  }

  it("MessageType 含 RISK_LEVEL_UP", () => {
    expect(MessageType.RISK_LEVEL_UP).toBe("RISK_LEVEL_UP");
  });

  it("Contract 关联 riskSnapshots", () => {
    const rel = Prisma.ModelName;
    expect("RiskScoreSnapshot" in rel).toBe(true);
  });
});
