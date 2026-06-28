-- 为 Invoice 增加附件 JSON 快照字段,与 Contract.attachments 保持一致
-- 2026-06-23 部署时发现:在已手工添加 attachments 列的环境会冲突
-- 改为 ADD COLUMN IF NOT EXISTS 幂等版,DB 终态与原意图一致
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "attachments" JSONB NOT NULL DEFAULT '[]';
