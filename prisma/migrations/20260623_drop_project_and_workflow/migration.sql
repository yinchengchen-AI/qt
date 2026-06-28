-- 删除项目管理和工作流引擎模块
-- 范围: Project / WorkflowTemplate / WorkflowStage / WorkflowTask / WorkflowTaskInstance 五张表

BEGIN;

-- 1. 删表(外键约束会让 Prisma 自动排序, 这里按从属到主)
DROP TABLE IF EXISTS "WorkflowTaskInstance" CASCADE;
DROP TABLE IF EXISTS "WorkflowTask" CASCADE;
DROP TABLE IF EXISTS "WorkflowStage" CASCADE;
DROP TABLE IF EXISTS "WorkflowTemplate" CASCADE;
DROP TABLE IF EXISTS "Project" CASCADE;

-- 2. 移除字典类别 (PROJECT_STATUS 状态机字典, 整体已经不在业务中使用)
DELETE FROM "Dictionary" WHERE category = 'PROJECT_STATUS';

COMMIT;
