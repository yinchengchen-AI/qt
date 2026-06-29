-- ProjectProgressLog 加 deletedAt, 支持项目软删时级联打标
-- 背景:
--   - 服务层 softDeleteProject (server/services/project.ts) 需要级联软删子表
--   - WorkflowTaskInstance 已有 deletedAt, 但 ProjectProgressLog 没有
--   - 没有 deletedAt 就只能硬删, 后续从回收站恢复项目时会丢失进度备注
-- 行为:
--   - 新字段全部可空, 历史行 deletedAt=NULL (=未软删) 不破坏
--   - 加复合索引 (projectId, deletedAt): 项目历史/进度查询走 deletedAt IS NULL
--     谓词, 大表下索引比全表扫快很多

BEGIN;

ALTER TABLE "ProjectProgressLog"
  ADD COLUMN "deletedAt" TIMESTAMPTZ(6);

CREATE INDEX "ProjectProgressLog_projectId_deletedAt_idx"
  ON "ProjectProgressLog"("projectId", "deletedAt");

COMMIT;
