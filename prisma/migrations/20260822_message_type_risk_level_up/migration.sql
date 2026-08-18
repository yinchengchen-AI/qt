-- MessageType 加 1 个新事件:
--   RISK_LEVEL_UP: risk-score-snapshot job 快照比对触发, 合同风险等级上调至
--     HIGH/CRITICAL 时通知 owner + admin; 每日汇总也用同 type (entityKey 带 SUMMARY 区分)
--
-- PG 12+ 允许在事务内 ALTER TYPE ADD VALUE, 这里包在 BEGIN/COMMIT 里跟其他迁移一致。
-- 部署路径: 本地 prisma migrate dev 走 schema 验证;生产 prisma migrate deploy 仅 apply 已有文件。

BEGIN;

ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'RISK_LEVEL_UP';

COMMIT;
