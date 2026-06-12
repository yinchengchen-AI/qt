-- Drop deprecated ProjectProgressLog.percent column
-- 数字进度自 v0.3.1 起由工作流任务完成度派生(Project.progressPct),
-- ProjectProgressLog 仅保留为项目级里程碑文本/时间线记录。
ALTER TABLE "ProjectProgressLog" DROP COLUMN IF EXISTS "percent";
