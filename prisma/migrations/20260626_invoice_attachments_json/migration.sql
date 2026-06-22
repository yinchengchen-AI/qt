-- 为 Invoice 增加附件 JSON 快照字段，与 Contract.attachments 保持一致
ALTER TABLE "Invoice" ADD COLUMN "attachments" JSONB NOT NULL DEFAULT '[]';
