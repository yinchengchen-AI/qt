-- MessageType 加 3 个新事件 (Phase 1.5 续签提醒 + Phase 3 联动补盲):
--   CONTRACT_RENEWAL_REMIND: 合同到期超 30 天未续签 (contract-renewal-remind job, 每周)
--   LINKAGE_NO_INVOICE: 生效 30 天无已开票发票 (daily-linkage-check job)
--   LINKAGE_INVOICE_PAYMENT_GAP: 已开票>=1万 且回款缺口>20% 且最新发票超 30 天 (同 job)
--
-- PG 12+ 允许在事务内 ALTER TYPE ADD VALUE, 与 20260724/20260822 前两个枚举迁移一致。

BEGIN;

ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'CONTRACT_RENEWAL_REMIND';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'LINKAGE_NO_INVOICE';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'LINKAGE_INVOICE_PAYMENT_GAP';

COMMIT;
