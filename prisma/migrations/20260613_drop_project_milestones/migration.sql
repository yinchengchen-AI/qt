-- Drop deprecated Project.milestones column
-- Replaced by WorkflowTaskInstance since v0.3.0; no application code references it.
ALTER TABLE "Project" DROP COLUMN IF EXISTS "milestones";
