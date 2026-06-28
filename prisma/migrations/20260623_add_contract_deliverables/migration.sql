-- 合同管理: 新增 deliverables 字段 (合同交付物清单)
-- 形如 [{ id, name, type, dueDate, quantity, unit, remark? }]; 自由结构, 由前端编辑器维护
-- 不参与合同/回款状态机; 仅作业务留痕 + 回款页"关联交付物"展示

BEGIN;

ALTER TABLE "Contract" ADD COLUMN "deliverables" JSONB;

COMMIT;
