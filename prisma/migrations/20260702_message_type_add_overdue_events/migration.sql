-- MessageType 加 2 个新事件:
--   CONTRACT_AUTO_OVERDUE_TERMINATED: tryAutoCloseOnOverdue 触发 (endDate+GRACE<now 仍未结清, 强关)
--   CONTRACT_EXPIRED_UNPAID: tickStaleContracts 触发 (endDate<now 但钱没收齐, 给 owner/admin 通知)
--
-- PG 12+ 允许在事务内 ALTER TYPE ADD VALUE, 这里包在 BEGIN/COMMIT 里跟其他迁移一致。
-- 部署路径: 本地 prisma migrate dev 走 schema 验证;生产 prisma migrate deploy 仅 apply 已有文件。

BEGIN;

ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'CONTRACT_AUTO_OVERDUE_TERMINATED';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'CONTRACT_EXPIRED_UNPAID';

COMMIT;
