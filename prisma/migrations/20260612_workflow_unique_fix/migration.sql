-- P2 修复:WorkflowTaskInstance 的 unique 约束
-- 原来 @@unique([projectId, taskId]) 阻止了循环任务的多次生成
-- 改成 @@unique([projectId, taskId, parentInstanceId]) 让每个 cycle 都是独立行
-- (parentInstanceId=null 的首实例只会有一个,非空时按 parent 唯一)

-- 1. 删旧唯一索引
DROP INDEX IF EXISTS "WorkflowTaskInstance_projectId_taskId_key";

-- 2. 加新唯一索引
CREATE UNIQUE INDEX "WorkflowTaskInstance_projectId_taskId_parentInstanceId_key"
  ON "WorkflowTaskInstance" ("projectId", "taskId", "parentInstanceId");
