-- =====================================================
-- 客户状态机自动化 (P 客户状态机优化 §6): 增量字段 + 2 个新事件
--
-- 1) Customer 表加 2 列:
--      - lastAutoAppliedAt: 最近一次系统自动写状态的时间 (nullable, 旧数据全空)
--      - lastAutoRule:      触发的规则 ID (CONTRACT_ACTIVATED / ALL_CONTRACTS_CLOSED /
--                           INACTIVE_LOST / INACTIVE_FROZEN), UI 用来展示
--                           "系统因 XX 改了你的状态" + 撤销按钮可点
--   两列都 nullable, 不需 backfill; 撤销成功时清空 lastAutoAppliedAt。
--
-- 2) MessageType 加 2 个事件:
--      - CUSTOMER_STATUS_AUTO_APPLIED: 系统自动写状态, 给 owner 发通知
--      - CUSTOMER_STATUS_AUTO_REVERTED: 撤销窗口期内, owner 撤销了系统自动写
--   ALTER TYPE ADD VALUE 在 PG 12+ 允许独立事务; 跟 20260702_message_type_add_overdue_events
--   的迁移一致, 包在 BEGIN/COMMIT 里。
-- =====================================================

-- 1) Customer 加 2 列
ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "lastAutoAppliedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "lastAutoRule" TEXT;

-- 2) MessageType 加 2 个值
BEGIN;

ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'CUSTOMER_STATUS_AUTO_APPLIED';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'CUSTOMER_STATUS_AUTO_REVERTED';

COMMIT;
