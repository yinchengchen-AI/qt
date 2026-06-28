-- 企业资产库 v1: Attachment 新增 isPrimary 字段
-- 标识 PERSONNEL_CERT(证书扫描件) / TEMPLATE(模板文件) 的主附件;
-- 详情页"附件"列表置顶并展示"主"Tag, 非上述两类的资产也允许存在 1 个主附件(以 attachmentIds 第一个为准)。
-- 历史数据全部默认 false, 由 scripts/migrate/asset-primary-attachments.ts 回填老 PERSONNEL_CERT/TEMPLATE 资产。

BEGIN;

ALTER TABLE "Attachment" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- 资产下"主附件"快速定位 (详情页排序 / 列表查询)
CREATE INDEX "Attachment_assetId_isPrimary_deletedAt_idx" ON "Attachment"("assetId", "isPrimary", "deletedAt");

COMMIT;
