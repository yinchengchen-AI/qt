-- Attachment 加 deliverableId 列: 合同交付物附件 (Contract.deliverables JSON 列表内的某条 id)
--
-- 背景: 合同管理里"交付物" (deliverables, JSON 自由结构) 现在需要允许用户上传实际
--   交付的文件 (报告 / 证书 / 培训材料等). 复用 Attachment 表 + MinIO 基础设施,
--   避免新建主表/打破"deliverables 是自由结构"的既有设计.
-- 行为:
--   - 新列 nullable, 历史行 deliverableId=NULL (视为"非交付物附件"),行为完全不变
--   - 索引: 业务高频按 (contractId, deliverableId, deletedAt) 拉某个交付物下的附件清单
--   - 不加外键: deliverableId 是弱外键 (Contract.deliverables 是 JSONB),
--     在 server/storage/presign.ts 与 server/services/contract.ts 运行时校验
--     deliverableId 落在合同 deliverables 数组里

BEGIN;

ALTER TABLE "Attachment" ADD COLUMN "deliverableId" TEXT;

CREATE INDEX "Attachment_contractId_deliverableId_deletedAt_idx"
  ON "Attachment" ("contractId", "deliverableId", "deletedAt");

COMMIT;
