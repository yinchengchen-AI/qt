-- MessageType 加 1 个新事件:
--   CONTRACT_PAID_INVOICE_PENDING: tickStaleContracts 触发, 回款已足额但开票不足额,
--     这种合同 tryAutoClose (要双足额) 永不完结也无人感知, 通知 owner/admin 补开发票
--
-- PG 12+ 允许在事务内 ALTER TYPE ADD VALUE, 这里包在 BEGIN/COMMIT 里跟其他迁移一致。
-- 部署路径: 本地 prisma migrate dev 走 schema 验证;生产 prisma migrate deploy 仅 apply 已有文件。

BEGIN;

ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'CONTRACT_PAID_INVOICE_PENDING';

COMMIT;
