-- Project.milestones 字段自 v0.3.0 起废弃，v0.3.1 硬迁移物理删除
ALTER TABLE "Project" DROP COLUMN IF EXISTS "milestones";
