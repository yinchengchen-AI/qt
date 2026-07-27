-- MessageType 加 2 个新事件:
--   INVOICE_ISSUED:  invoiceAction issue 触发, 通知申请人发票已开具
--   INVOICE_REJECTED: invoiceAction reject 触发, 通知申请人发票被驳回 (含原因)
--
-- PG 12+ 允许在事务内 ALTER TYPE ADD VALUE, 这里包在 BEGIN/COMMIT 里跟其他迁移一致。
-- 部署路径: 本地 prisma migrate dev 走 schema 验证;生产 prisma migrate deploy 仅 apply 已有文件。

BEGIN;

ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'INVOICE_ISSUED';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'INVOICE_REJECTED';

COMMIT;
