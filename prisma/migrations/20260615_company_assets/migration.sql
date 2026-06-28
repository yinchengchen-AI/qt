-- =====================================================
-- 企业资产库 (CompanyAsset) - 建表 + RLS 策略
-- v1:全员可读,无 SALES 行级隔离(资产是公司级共享素材,不分个人)
-- 与 lib/assets/permissions 一致:READ = 5 角色全有
-- =====================================================

-- CreateTable:CompanyAsset(必须先建,Attachment.assetId 外键才找得到目标)
CREATE TABLE IF NOT EXISTS "CompanyAsset" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "attributes" JSONB NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "validFrom" TIMESTAMPTZ(6),
    "validTo" TIMESTAMPTZ(6),
    "ownerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "CompanyAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex(IF NOT EXISTS 兜底,部分场景下上次执行可能已建过)
CREATE UNIQUE INDEX IF NOT EXISTS "CompanyAsset_code_key" ON "CompanyAsset"("code");
CREATE INDEX IF NOT EXISTS "CompanyAsset_type_status_deletedAt_idx" ON "CompanyAsset"("type", "status", "deletedAt");
CREATE INDEX IF NOT EXISTS "CompanyAsset_validTo_deletedAt_idx" ON "CompanyAsset"("validTo", "deletedAt");
CREATE INDEX IF NOT EXISTS "CompanyAsset_ownerUserId_idx" ON "CompanyAsset"("ownerUserId");

-- AddForeignKey:CompanyAsset -> User(owner)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CompanyAsset_ownerUserId_fkey'
  ) THEN
    ALTER TABLE "CompanyAsset"
      ADD CONSTRAINT "CompanyAsset_ownerUserId_fkey"
      FOREIGN KEY ("ownerUserId") REFERENCES "User"("id")
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END$$;

-- Attachment 关联资产:assetId 列 + 外键 + 索引
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "assetId" TEXT;
CREATE INDEX IF NOT EXISTS "Attachment_assetId_deletedAt_idx" ON "Attachment"("assetId", "deletedAt");
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Attachment_assetId_fkey'
  ) THEN
    ALTER TABLE "Attachment"
      ADD CONSTRAINT "Attachment_assetId_fkey"
      FOREIGN KEY ("assetId") REFERENCES "CompanyAsset"("id")
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END$$;

-- RLS
ALTER TABLE "CompanyAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attachment" ENABLE ROW LEVEL SECURITY;

-- CompanyAsset:全员可读,无 SALES 隔离
DROP POLICY IF EXISTS company_asset_open_read ON "CompanyAsset";
CREATE POLICY company_asset_open_read ON "CompanyAsset"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    current_setting('app.user_role', true) IN ('ADMIN', 'SALES', 'FINANCE', 'OPS', 'EXPERT')
  );

-- Attachment 资产附件:仅持有 ASSET READ 权限即可读(同上)
DROP POLICY IF EXISTS attachment_asset_open_read ON "Attachment";
CREATE POLICY attachment_asset_open_read ON "Attachment"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    (
      "assetId" IS NOT NULL
      AND current_setting('app.user_role', true) IN ('ADMIN', 'SALES', 'FINANCE', 'OPS', 'EXPERT')
    )
  );
