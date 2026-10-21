-- =====================================================
-- AI 用量统计与结果缓存: AiUsageLog + AiResponseCache
--   - AiUsageLog: 每次 AI 调用一行 (含缓存命中 cacheHit=true 与失败 status=FAILURE),
--     feature/status 为 String 列 (项目约定: 不建 PG enum, 应用层 union 约束)。
--   - AiResponseCache: cacheKey 唯一 (sha256(feature + model + 规范化 payload)),
--     过期 lazy 判定 (查询时比 expiresAt), upsert 写入, hitCount 记录命中次数。
--
-- 按 AGENTS.md 规则: 新表必须显式 GRANT 给 qt_app
--   (BYPASSRLS 只旁路 RLS, 不旁路表级权限; DunningNote 42501 事故教训)。
-- =====================================================

BEGIN;

-- 1) AiUsageLog: AI 调用日志
CREATE TABLE "AiUsageLog" (
  "id"               TEXT NOT NULL,
  "feature"          TEXT NOT NULL,
  "userId"           TEXT NOT NULL,
  "model"            TEXT NOT NULL,
  "cacheHit"         BOOLEAN NOT NULL DEFAULT false,
  "promptTokens"     INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  "costEstimate"     DECIMAL(10,6),
  "latencyMs"        INTEGER NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'SUCCESS',
  "errorMessage"     TEXT,
  "requestId"        TEXT,
  "createdAt"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiUsageLog_feature_createdAt_idx" ON "AiUsageLog"("feature", "createdAt");
CREATE INDEX "AiUsageLog_userId_createdAt_idx" ON "AiUsageLog"("userId", "createdAt");
CREATE INDEX "AiUsageLog_createdAt_idx" ON "AiUsageLog"("createdAt");

-- 2) AiResponseCache: AI 响应缓存
CREATE TABLE "AiResponseCache" (
  "id"        TEXT NOT NULL,
  "cacheKey"  TEXT NOT NULL,
  "feature"   TEXT NOT NULL,
  "response"  JSONB NOT NULL,
  "hitCount"  INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiResponseCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiResponseCache_cacheKey_key" ON "AiResponseCache"("cacheKey");
CREATE INDEX "AiResponseCache_feature_expiresAt_idx" ON "AiResponseCache"("feature", "expiresAt");

-- 3) GRANT 给 qt_app (DO 块判重: 开发环境无 qt_app 角色时跳过, 生产必执行)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qt_app') THEN
    GRANT ALL ON TABLE "AiUsageLog" TO qt_app;
    GRANT ALL ON TABLE "AiResponseCache" TO qt_app;
  END IF;
END $$;

COMMIT;
