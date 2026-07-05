-- =====================================================
-- 报表中心重新设计：DROP 旧 ReportDefinition / ReportSnapshot，
-- 新建 ReportDefinition / ReportJob / ReportSnapshot / ReportSubscription
-- =====================================================

BEGIN;

-- 1. 清理旧表（如存在）
DROP TABLE IF EXISTS "ReportSnapshot" CASCADE;
DROP TABLE IF EXISTS "ReportDefinition" CASCADE;

-- 2. 新 ReportDefinition
CREATE TABLE "ReportDefinition" (
    "id"                TEXT NOT NULL,
    "code"              TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "description"       TEXT,
    "category"          TEXT NOT NULL,
    "executorCode"      TEXT NOT NULL,
    "config"            JSONB NOT NULL DEFAULT '{}',
    "defaultPeriodType" TEXT NOT NULL DEFAULT 'MONTH',
    "isActive"          BOOLEAN NOT NULL DEFAULT true,
    "sortOrder"         INTEGER NOT NULL DEFAULT 0,
    "createdAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"         TIMESTAMPTZ(6),

    CONSTRAINT "ReportDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportDefinition_code_key" ON "ReportDefinition"("code");
CREATE INDEX "ReportDefinition_category_isActive_sortOrder_idx" ON "ReportDefinition"("category", "isActive", "sortOrder");

-- 3. 新 ReportJob
CREATE TABLE "ReportJob" (
    "id"              TEXT NOT NULL,
    "definitionId"    TEXT NOT NULL,
    "triggerType"     TEXT NOT NULL,
    "periodType"      TEXT NOT NULL,
    "periodLabel"     TEXT NOT NULL,
    "from"            TIMESTAMPTZ(6) NOT NULL,
    "to"              TIMESTAMPTZ(6) NOT NULL,
    "status"          TEXT NOT NULL DEFAULT 'PENDING',
    "progressPercent" SMALLINT,
    "errorMessage"    TEXT,
    "context"         JSONB NOT NULL DEFAULT '{}',
    "startedAt"       TIMESTAMPTZ(6),
    "completedAt"     TIMESTAMPTZ(6),
    "snapshotId"      TEXT,
    "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById"     TEXT NOT NULL,

    CONSTRAINT "ReportJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportJob_snapshotId_key" ON "ReportJob"("snapshotId");
CREATE INDEX "ReportJob_status_createdAt_idx" ON "ReportJob"("status", "createdAt");
CREATE INDEX "ReportJob_definitionId_createdAt_idx" ON "ReportJob"("definitionId", "createdAt");

-- 4. 新 ReportSnapshot
CREATE TABLE "ReportSnapshot" (
    "id"            TEXT NOT NULL,
    "definitionId"  TEXT NOT NULL,
    "periodType"    TEXT NOT NULL,
    "periodLabel"   TEXT NOT NULL,
    "from"          TIMESTAMPTZ(6) NOT NULL,
    "to"            TIMESTAMPTZ(6) NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'READY',
    "payload"       JSONB NOT NULL,
    "sourceHash"    TEXT,
    "generatedById" TEXT NOT NULL,
    "generatedAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"     TIMESTAMPTZ(6),
    "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"     TIMESTAMPTZ(6),

    CONSTRAINT "ReportSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportSnapshot_definition_periodLabel_key" ON "ReportSnapshot"("definitionId", "periodType", "periodLabel");
CREATE INDEX "ReportSnapshot_definitionId_generatedAt_idx" ON "ReportSnapshot"("definitionId", "generatedAt");
CREATE INDEX "ReportSnapshot_status_expiresAt_idx" ON "ReportSnapshot"("status", "expiresAt");
CREATE INDEX "ReportSnapshot_deletedAt_idx" ON "ReportSnapshot"("deletedAt");

-- 5. 新 ReportSubscription
CREATE TABLE "ReportSubscription" (
    "id"              TEXT NOT NULL,
    "definitionId"    TEXT NOT NULL,
    "userId"          TEXT NOT NULL,
    "periodType"      TEXT NOT NULL,
    "channels"        JSONB NOT NULL DEFAULT '["MESSAGE_CENTER"]',
    "schedule"        TEXT,
    "isActive"        BOOLEAN NOT NULL DEFAULT true,
    "lastTriggeredAt" TIMESTAMPTZ(6),
    "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReportSubscription_definition_user_period_key" ON "ReportSubscription"("definitionId", "userId", "periodType");
CREATE INDEX "ReportSubscription_userId_isActive_idx" ON "ReportSubscription"("userId", "isActive");

-- 6. 外键关系
ALTER TABLE "ReportJob"
    ADD CONSTRAINT "ReportJob_definitionId_fkey"
    FOREIGN KEY ("definitionId") REFERENCES "ReportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportJob"
    ADD CONSTRAINT "ReportJob_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReportJob"
    ADD CONSTRAINT "ReportJob_snapshotId_fkey"
    FOREIGN KEY ("snapshotId") REFERENCES "ReportSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ReportSnapshot"
    ADD CONSTRAINT "ReportSnapshot_definitionId_fkey"
    FOREIGN KEY ("definitionId") REFERENCES "ReportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportSnapshot"
    ADD CONSTRAINT "ReportSnapshot_generatedById_fkey"
    FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReportSubscription"
    ADD CONSTRAINT "ReportSubscription_definitionId_fkey"
    FOREIGN KEY ("definitionId") REFERENCES "ReportDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReportSubscription"
    ADD CONSTRAINT "ReportSubscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. 权限
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qt_app') THEN
        GRANT ALL ON TABLE "ReportDefinition" TO qt_app;
        GRANT ALL ON TABLE "ReportJob" TO qt_app;
        GRANT ALL ON TABLE "ReportSnapshot" TO qt_app;
        GRANT ALL ON TABLE "ReportSubscription" TO qt_app;
    END IF;
END $$;

COMMIT;
