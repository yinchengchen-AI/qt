-- 把 Message.type 从 text 收紧到 enum MessageType,并加复合索引支持去重查询
--
-- 现有数据 (PAYMENT_RECEIVED / CONTRACT_AUTO_EXECUTED) 全部落在新 enum 内, USING 子句
-- 原地转换,不需要数据回填。如果将来加新事件,需要先扩 enum 再 ALTER 列。

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM (
  'CONTRACT_EXPIRING',
  'INVOICE_OVERDUE_PAYMENT',
  'PAYMENT_RECEIVED',
  'CUSTOMER_STATUS_SUGGEST',
  'CONTRACT_AUTO_EXECUTED',
  'CONTRACT_AUTO_COMPLETED',
  'CONTRACT_AUTO_EXPIRED'
);

-- AlterTable
ALTER TABLE "Message"
  ALTER COLUMN "type" TYPE "MessageType" USING "type"::"MessageType";

-- DropIndex (单列 type 索引被下面的复合索引替代)
DROP INDEX IF EXISTS "Message_type_idx";

-- CreateIndex (cron 任务的去重查询:`type + receiverUserId + createdAt` + JSON path.id)
-- 复合索引把扫描收敛到"今天 + 该用户 + 该类型"的小窗口,JSON 路径再二次过滤
CREATE INDEX "Message_type_receiverUserId_createdAt_idx" ON "Message"("type", "receiverUserId", "createdAt");
