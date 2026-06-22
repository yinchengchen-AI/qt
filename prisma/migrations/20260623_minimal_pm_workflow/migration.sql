-- PR-2: 项目管理 + 工作流引擎最简化 (乙档) — Schema 真删
-- 设计文档: docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md
-- 范围: Project 状态收敛, 阶段 5→2 合并, 删 13 列 + ProjectProgressLog 表, 修索引

BEGIN;

-- =====================================================
-- 1. Project.status 数据迁移: DELIVERED/ACCEPTED → CLOSED
-- =====================================================
UPDATE "Project" SET status = 'CLOSED' WHERE status IN ('DELIVERED', 'ACCEPTED');

-- =====================================================
-- 2. WorkflowTaskInstance.reviewStatus → status 映射
-- =====================================================
UPDATE "WorkflowTaskInstance"
SET status = CASE
  WHEN "reviewStatus" = 'REVIEWING' THEN 'IN_PROGRESS'
  WHEN "reviewStatus" IN ('REVIEWED', 'APPROVED') THEN 'COMPLETED'
  WHEN "reviewStatus" = 'REJECTED' THEN 'BLOCKED'
  ELSE status
END
WHERE "reviewStatus" IS NOT NULL;

-- =====================================================
-- 3. WorkflowStage 阶段合并: PREP/REQ/CONTRACT/EXECUTE → DO, FOLLOWUP → DELIVER
-- =====================================================
DO $$
DECLARE
  tpl RECORD;
  do_stage_id TEXT;
  del_stage_id TEXT;
  old_stage RECORD;
BEGIN
  FOR tpl IN SELECT id FROM "WorkflowTemplate" LOOP
    -- 创建 DO 阶段
    INSERT INTO "WorkflowStage" (id, "templateId", phase, code, name, sort, "isRequired", description)
    VALUES (gen_random_uuid()::text, tpl.id, 'DO', 'DO', '实施', 0, true, '实施阶段')
    RETURNING id INTO do_stage_id;

    -- 创建 DELIVER 阶段
    INSERT INTO "WorkflowStage" (id, "templateId", phase, code, name, sort, "isRequired", description)
    VALUES (gen_random_uuid()::text, tpl.id, 'DELIVER', 'DELIVER', '交付', 1, true, '交付阶段')
    RETURNING id INTO del_stage_id;

    -- 迁移 task 关联
    FOR old_stage IN SELECT * FROM "WorkflowStage" WHERE "templateId" = tpl.id AND phase IN ('PREP', 'REQUIREMENT', 'CONTRACT', 'EXECUTE', 'FOLLOWUP') LOOP
      IF old_stage.phase IN ('PREP', 'REQUIREMENT', 'CONTRACT', 'EXECUTE') THEN
        UPDATE "WorkflowTask" SET "stageId" = do_stage_id WHERE "stageId" = old_stage.id;
      ELSE
        UPDATE "WorkflowTask" SET "stageId" = del_stage_id WHERE "stageId" = old_stage.id;
      END IF;
    END LOOP;

    -- 删旧阶段
    DELETE FROM "WorkflowStage" WHERE "templateId" = tpl.id AND phase IN ('PREP', 'REQUIREMENT', 'CONTRACT', 'EXECUTE', 'FOLLOWUP');
  END LOOP;
END $$;

-- =====================================================
-- 4. 删 ProjectProgressLog 整表
-- =====================================================
DROP TABLE IF EXISTS "ProjectProgressLog";

-- =====================================================
-- 5. 删 WorkflowTask 的 7 个废弃列
-- =====================================================
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "requiresDeliverable";
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "requiresOnsite";
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "requiresTwoStepReview";
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "isRecurring";
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "recurrenceUnit";
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "recurrenceInterval";
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "estimateDays";

-- =====================================================
-- 6. 删 WorkflowTaskInstance 的 5 个废弃列
-- =====================================================
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN IF EXISTS "parentInstanceId";
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN IF EXISTS "reviewStatus";
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN IF EXISTS "reviewedById";
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN IF EXISTS "reviewedAt";
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN IF EXISTS "attachments";

-- =====================================================
-- 7. 修 unique 索引: 原 3 字段 (projectId, taskId, parentInstanceId) → 2 字段
-- =====================================================
ALTER TABLE "WorkflowTaskInstance" DROP CONSTRAINT IF EXISTS "WorkflowTaskInstance_projectId_taskId_parentInstanceId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowTaskInstance_projectId_taskId_key" ON "WorkflowTaskInstance"("projectId", "taskId");

COMMIT;
