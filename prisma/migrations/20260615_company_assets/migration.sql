-- =====================================================
-- 企业资产库 (CompanyAsset) - RLS 策略
-- v1:全员可读,无 SALES 行级隔离(资产是公司级共享素材,不分个人)
-- 与 lib/assets/permissions 一致:READ = 5 角色全有
-- =====================================================

ALTER TABLE "CompanyAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Attachment" ENABLE ROW LEVEL SECURITY;

-- CompanyAsset:全员可读,无 SALES 隔离
CREATE POLICY company_asset_open_read ON "CompanyAsset"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    current_setting('app.user_role', true) IN ('ADMIN', 'SALES', 'FINANCE', 'OPS', 'EXPERT')
  );

-- Attachment 资产附件:仅持有 ASSET READ 权限即可读(同上)
CREATE POLICY attachment_asset_open_read ON "Attachment"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    (
      "assetId" IS NOT NULL
      AND current_setting('app.user_role', true) IN ('ADMIN', 'SALES', 'FINANCE', 'OPS', 'EXPERT')
    )
  );
