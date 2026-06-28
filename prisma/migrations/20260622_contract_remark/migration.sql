-- Contract 加 remark 字段 (自由文本备注, 跟 reviewComment 审批意见区分)
--
-- 背景: 合同管理需要"备注"字段记录非结构化信息 (签约背景/特殊条款/客户偏好等),
--   跟 reviewComment (审批意见/驳回理由) 是两个东西. 之前 schema 没这块, 现在补上.
-- 行为:
--   - 新字段可空, 历史行 remark=NULL 不破坏
--   - 后续前端表单暴露 + 详情/列表显示
--   - 不加索引 (备注是自由文本, 不参与查询谓词)

BEGIN;

ALTER TABLE "Contract" ADD COLUMN "remark" TEXT;

COMMIT;
