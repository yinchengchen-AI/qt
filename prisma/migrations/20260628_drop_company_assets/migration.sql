-- =====================================================
-- 下线企业资产库 (CompanyAsset) 模块
-- 范围: CompanyAsset 表 + Attachment.assetId/isPrimary 字段/外键/索引 + 相关 RLS 策略
-- 沿用 20260623_drop_project_and_workflow 的硬下线模式 (DROP TABLE CASCADE),
-- 与 lib/permissions.ts 中移除 RESOURCE.ASSET 一致。
-- =====================================================

BEGIN;

-- 1. 移除 Attachment 上资产相关的 RLS 策略
DROP POLICY IF EXISTS attachment_asset_open_read ON "Attachment";

-- 2. 移除 Attachment 上的资产外键与索引
ALTER TABLE "Attachment" DROP CONSTRAINT IF EXISTS "Attachment_assetId_fkey";
DROP INDEX IF EXISTS "Attachment_assetId_deletedAt_idx";
DROP INDEX IF EXISTS "Attachment_assetId_isPrimary_deletedAt_idx";

-- 3. 移除 CompanyAsset 表 (CASCADE 自动解除 AssetAttachments 关系)
DROP TABLE IF EXISTS "CompanyAsset" CASCADE;

-- 4. 移除 Attachment.assetId 列 (CompanyAsset 已无, 字段已无意义)
ALTER TABLE "Attachment" DROP COLUMN IF EXISTS "assetId";

-- 5. 移除 Attachment.isPrimary 列 (与资产 PERSONNEL_CERT/TEMPLATE 主附件绑定, 资产下线后无业务消费者)
ALTER TABLE "Attachment" DROP COLUMN IF EXISTS "isPrimary";

-- 6. 移除资产相关的字典 (ASSET_TAG 由 admin 维护, 资产下线后无业务消费者)
DELETE FROM "Dictionary" WHERE category = 'ASSET_TAG';

COMMIT;
