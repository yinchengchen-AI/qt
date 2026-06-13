-- =====================================================
-- 工作流期望角色与系统内置角色对齐
-- - 新增 EXPERT 系统角色
-- - WorkflowTask.requiredRole 中残留的 SALES_LEAD 折回 SALES
-- - 给 WorkflowTask.requiredRole 加外键(FK -> Role.code, RESTRICT)
-- =====================================================

-- 1) 新增 EXPERT 系统角色
--    permissions 用占位 JSON 数组,seed 阶段会用 ROLE_PERMISSIONS["EXPERT"] 覆盖
INSERT INTO "Role" ("id", "code", "name", "description", "permissions", "isSystem", "createdAt", "updatedAt")
VALUES (
  'role_expert_seed_placeholder',
  'EXPERT',
  '技术专家',
  '承担现场勘查、报告撰写等专业工作',
  '[]'::jsonb,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("code") DO NOTHING;

-- 2) 旧数据兜底:把残留的 SALES_LEAD 改成 SALES
UPDATE "WorkflowTask"
SET "requiredRole" = 'SALES'
WHERE "requiredRole" = 'SALES_LEAD';

-- 3) 加外键约束
ALTER TABLE "WorkflowTask"
ADD CONSTRAINT "WorkflowTask_requiredRole_fkey"
FOREIGN KEY ("requiredRole") REFERENCES "Role"("code")
ON DELETE RESTRICT
ON UPDATE CASCADE;

-- 4) 加索引(对应 schema 里的 @@index([requiredRole]))
CREATE INDEX IF NOT EXISTS "WorkflowTask_requiredRole_idx" ON "WorkflowTask"("requiredRole");
