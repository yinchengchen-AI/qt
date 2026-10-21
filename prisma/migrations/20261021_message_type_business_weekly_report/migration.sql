-- MessageType 加 1 个新事件 (经营周报定时推送):
--   BUSINESS_WEEKLY_REPORT: 每周一 09:00 给 ADMIN ∪ FINANCE 发上周业绩总览/账龄摘要/业绩排行
--     (weekly-business-report job, entityKey 按 ISO 周幂等)
--
-- PG 12+ 允许在事务内 ALTER TYPE ADD VALUE, 与 20260822 前两个枚举迁移一致。
-- 枚举 ALTER 无需 GRANT (不涉及表级权限)。

BEGIN;

ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'BUSINESS_WEEKLY_REPORT';

COMMIT;
