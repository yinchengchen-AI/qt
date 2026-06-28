-- Attachment 加 isDeliverable 列 (合同交付物附件标记) + 调整索引
-- 同时下线结构化 deliverables 方案 (Contract.deliverables JSON + Attachment.deliverableId)
--
-- 背景: 交付物之前是合同表单里的 ProFormList 结构化清单 (name/type/dueDate/quantity/unit/remark);
--   调整后改为合同详情 tab 内直接上传文件 (附件本身即交付物), 不再需要结构化元数据.
--   简化后:
--     - Contract.deliverables JSON: 移除 (前端不再有编辑器)
--     - Attachment.deliverableId: 移除 (不再需要弱外键)
--     - Attachment.isDeliverable Boolean: 新增, 区分"交付物附件"和"通用合同附件"
--   历史行: Contract.deliverables=NULL, Attachment.deliverableId=NULL (无害; isDeliverable=false
--   表示"通用合同附件", 走旧规则)
--
-- 行为:
--   - isDeliverable NOT NULL DEFAULT FALSE, 历史行归入"通用合同附件"
--   - 索引调整为 (contractId, isDeliverable, deletedAt) 覆盖详情 tab 的查询
--   - 同步删除旧的 (contractId, deliverableId, deletedAt) 复合索引

BEGIN;

ALTER TABLE "Attachment" ADD COLUMN "isDeliverable" BOOLEAN NOT NULL DEFAULT FALSE;

DROP INDEX IF EXISTS "Attachment_contractId_deliverableId_deletedAt_idx";

CREATE INDEX "Attachment_contractId_isDeliverable_deletedAt_idx"
  ON "Attachment" ("contractId", "isDeliverable", "deletedAt");

ALTER TABLE "Attachment" DROP COLUMN "deliverableId";

ALTER TABLE "Contract" DROP COLUMN "deliverables";

COMMIT;
