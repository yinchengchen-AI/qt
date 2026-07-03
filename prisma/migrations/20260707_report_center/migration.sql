-- =====================================================
-- 报表中心 (Report Center)
--   - ReportDefinition: 报表模板定义
--   - ReportSnapshot: 已生成的报表快照
-- =====================================================

BEGIN;

CREATE TABLE "ReportDefinition" (
    "id"            TEXT NOT NULL,
    "code"          TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "description"   TEXT,
    "type"          TEXT NOT NULL,
    "periodType"    TEXT NOT NULL,
    "defaultMetrics" JSONB NOT NULL,
    "dimensions"    JSONB NOT NULL DEFAULT '[]',
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "sortOrder"     INTEGER NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"     TIMESTAMPTZ(6),

    CONSTRAINT "ReportDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportDefinition_code_key" ON "ReportDefinition"("code");
CREATE INDEX "ReportDefinition_type_idx" ON "ReportDefinition"("type");
CREATE INDEX "ReportDefinition_isActive_sortOrder_idx" ON "ReportDefinition"("isActive", "sortOrder");

CREATE TABLE "ReportSnapshot" (
    "id"            TEXT NOT NULL,
    "definitionId"  TEXT NOT NULL,
    "periodType"    TEXT NOT NULL,
    "periodLabel"   TEXT NOT NULL,
    "from"          TIMESTAMPTZ(6) NOT NULL,
    "to"            TIMESTAMPTZ(6) NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'PENDING',
    "payload"       JSONB NOT NULL,
    "hash"          TEXT,
    "generatedById" TEXT NOT NULL,
    "generatedAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"     TIMESTAMPTZ(6),
    "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"     TIMESTAMPTZ(6),

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportSnapshot_definition_periodLabel_key" ON "ReportSnapshot"("definitionId", "periodType", "periodLabel");
CREATE INDEX "ReportSnapshot_definitionId_status_idx" ON "ReportSnapshot"("definitionId", "status");
CREATE INDEX "ReportSnapshot_generatedAt_idx" ON "ReportSnapshot"("generatedAt");
CREATE INDEX "ReportSnapshot_deletedAt_idx" ON "ReportSnapshot"("deletedAt");

ALTER TABLE "ReportSnapshot"
    ADD CONSTRAINT "ReportSnapshot_definitionId_fkey"
    FOREIGN KEY ("definitionId") REFERENCES "ReportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportSnapshot"
    ADD CONSTRAINT "ReportSnapshot_generatedById_fkey"
    FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AGENTS.md: 新表必须显式 GRANT 给 qt_app；开发环境 qt_app 可能不存在，用 DO 块条件执行
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qt_app') THEN
        GRANT ALL ON TABLE "ReportDefinition" TO qt_app;
        GRANT ALL ON TABLE "ReportSnapshot" TO qt_app;
    END IF;
END $$;

COMMIT;
