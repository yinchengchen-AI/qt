-- RiskScoreSnapshot 合同风险评分日快照 (Phase 2 风险预警引擎)
--   用途: (1) 风险详情 30 天趋势折线数据源 (2) 升档检测 (今日 level > 昨日 level
--         且达 HIGH/CRITICAL 时发 RISK_LEVEL_UP 站内信)
--   写入: server/jobs/risk-score-snapshot.ts 每日对全部 ACTIVE 合同算分幂等 upsert
--   口径: 五维度加权分段函数见 server/services/contract/risk-score.ts 与 spec §5.1
CREATE TABLE "RiskScoreSnapshot" (
    "id"           TEXT        NOT NULL,
    "contractId"   TEXT        NOT NULL,
    "score"        INTEGER     NOT NULL,
    "level"        TEXT        NOT NULL,
    "dimensions"   JSONB       NOT NULL,
    "snapshotDate" DATE        NOT NULL,
    "createdAt"    TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskScoreSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RiskScoreSnapshot_contractId_snapshotDate_key" ON "RiskScoreSnapshot"("contractId", "snapshotDate");
CREATE INDEX "RiskScoreSnapshot_snapshotDate_level_idx" ON "RiskScoreSnapshot"("snapshotDate", "level");

ALTER TABLE "RiskScoreSnapshot" ADD CONSTRAINT "RiskScoreSnapshot_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AGENTS.md 强制要求: 新表必须显式 GRANT 给 qt_app (BYPASSRLS 不旁路表级权限)
GRANT ALL ON TABLE "RiskScoreSnapshot" TO qt_app;
