-- 报表中心：快照状态默认值与当前实现对齐（同步生成后直接 READY）
BEGIN;
ALTER TABLE "ReportSnapshot" ALTER COLUMN "status" SET DEFAULT 'READY';
COMMIT;
