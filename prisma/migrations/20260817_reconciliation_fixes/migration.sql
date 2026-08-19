-- 对账中心修复: MessageType enum 补值 + BankTransaction.paymentPrevStatus
--   背景: v0.20.0 担心"生产 qt_app 非 MessageType owner, ALTER TYPE 42501",
--         把 4 个 RECONCILIATION_* 消息类型留在应用层枚举, 没扩 PG enum。
--         但 Message.type 列仍是原生 enum, Prisma Client 写库直接拒
--         (Invalid value for argument `type`), 被 service try/catch 吞掉,
--         导致对账通知全部静默丢失。
--   依据: 迁移实际以 MIGRATION_DATABASE_URL 的 qitai(DB owner) 执行
--         (见 scripts/prod/deploy.sh L72/L140-141), qt_app 只是应用运行时账号;
--         20260701/20260702/20260724 三个 ALTER TYPE 迁移均已成功上过生产。
--   内容:
--     1. MessageType 补 4 个 RECONCILIATION_* 值 (IF NOT EXISTS 幂等)
--     2. BankTransaction 加 paymentPrevStatus, 记录匹配时回款原状态, unmatch 精确回滚

ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_AUTO_MATCHED';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_SUGGESTION';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_DISCREPANCY';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_WEEKLY_REPORT';

ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "paymentPrevStatus" TEXT;
