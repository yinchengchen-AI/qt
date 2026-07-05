-- 报表中心下线：删除 ReportDefinition / ReportJob / ReportSnapshot / ReportSubscription 表
-- 以及 User 上的三个反向关系字段。已合并到 main 的迁移文件保持不动（见 AGENTS.md 关于不可变迁移的约定），
-- 删表/删字段一律通过新增迁移完成。
--
-- 同步从 MessageType enum 移除 REPORT_READY 值。
-- PG 不支持 DROP VALUE for ENUM，标准做法是建新 enum + ALTER COLUMN + DROP 旧 type。
BEGIN;

-- 1. 删表（先删有 FK 的子表，再删父表）
DROP TABLE IF EXISTS "ReportSubscription" CASCADE;
DROP TABLE IF EXISTS "ReportSnapshot" CASCADE;
DROP TABLE IF EXISTS "ReportJob" CASCADE;
DROP TABLE IF EXISTS "ReportDefinition" CASCADE;

-- 2. 删 User 上的反向关系字段
ALTER TABLE "User" DROP COLUMN IF EXISTS "reportJobs";
ALTER TABLE "User" DROP COLUMN IF EXISTS "reportSnapshots";
ALTER TABLE "User" DROP COLUMN IF EXISTS "reportSubscriptions";

COMMIT;

-- 3. 清理可能存在的 REPORT_READY 历史消息（报表订阅触发后未被消费的）
-- 删行比改 type 更安全：旧消息没有链接目标（/reports/... 已经下掉）
DELETE FROM "Message" WHERE "type" = 'REPORT_READY';

-- 4. 从 MessageType enum 移除 REPORT_READY
DO $qt$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'MessageType' AND e.enumlabel = 'REPORT_READY'
  ) THEN
    ALTER TABLE "Message" ALTER COLUMN "type" TYPE text USING "type"::text;
    DROP TYPE "MessageType";
    CREATE TYPE "MessageType" AS ENUM (
      'CONTRACT_EXPIRING',
      'INVOICE_OVERDUE_PAYMENT',
      'PAYMENT_RECEIVED',
      'CUSTOMER_STATUS_SUGGEST',
      'CONTRACT_AUTO_EXECUTED',
      'CONTRACT_AUTO_COMPLETED',
      'CONTRACT_AUTO_EXPIRED',
      'CONTRACT_AUTO_OVERDUE_TERMINATED',
      'CONTRACT_EXPIRED_UNPAID',
      'CERTIFICATE_EXPIRING',
      'CUSTOMER_STATUS_AUTO_APPLIED',
      'CUSTOMER_STATUS_AUTO_REVERTED'
    );
    ALTER TABLE "Message" ALTER COLUMN "type" TYPE "MessageType" USING "type"::"MessageType";
  END IF;
END
$qt$;
