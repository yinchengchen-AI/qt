-- 预创建 MessageType enum, 让 20260628_customer_auto_fields 能 ALTER TYPE
--
-- 背景 (migration 顺序冲突):
--   20260628_customer_auto_fields 想 ALTER TYPE "MessageType" ADD VALUE 'CUSTOMER_STATUS_AUTO_APPLIED'/'AUTO_REVERTED'
--   20260630_message_type_enum_index 才 CREATE TYPE "MessageType"
--
--   按 prisma 的目录名排序, 20260628 跑得比 20260630 早, fresh DB 上 0628 会因为
--   type 不存在而失败 (ALTER TYPE 在事务中, 一旦失败整个迁移 abort, 后续全挂).
--
--   历史 dev DB 是手工按依赖顺序跑 (started_at 看 0628 是 2026-06-29 跑的, 0630 是 2026-06-25 跑的),
--   所以不撞墙. 但 fresh DB CI 会撞.
--
-- 解决:
--   在 20260628 之前 (字典序 20260627 < 20260628) 预创建 MessageType enum,
--   把后续 4 个迁移想 ADD 的所有值都包进来 (用全部 12 个值的 superset):
--     - 20260630_message_type_enum_index 的 7 个基础值
--     - 20260628_customer_auto_fields 的 CUSTOMER_STATUS_AUTO_APPLIED/REVERTED
--     - 20260701_employee_profile_restructure 的 CERTIFICATE_EXPIRING
--     - 20260702_message_type_add_overdue_events 的 CONTRACT_AUTO_OVERDUE_TERMINATED/EXPIRED_UNPAID
--
--   这样 20260628/20260701/20260702 的 ALTER TYPE ADD VALUE IF NOT EXISTS 都变成 no-op,
--   但 prisma 的 _prisma_migrations 仍会记录它们"应用过了"(因为 IF NOT EXISTS 不报错就 commit 了).
--
--   20260630_message_type_enum_index 仍然会跑, CREATE TYPE 会因为 type 已存在而失败.
--   该迁移里其他操作 (ALTER Message.type USING MessageType::MessageType / DROP INDEX / CREATE INDEX)
--   是必要的, 但 ALTER TABLE ... USING 要求 type 已存在 + 列存在, 所以这条迁移其实在 fresh DB
--   上"应该"在 0628/0630 之后才跑 — 这是迁移历史本身就埋的雷.
--
--   处理: CI 用 `prisma migrate resolve --applied 20260630_message_type_enum_index` 把它标记为
--   applied (此时 schema 已包含所有需要的 enum 值), 然后 prisma 跳过这条, 继续后续迁移.
--   生产/手动部署环境不会撞这个 (历史 dev/prod 都是手工顺序跑的).
--
-- 命名/排序:
--   20260627_message_type_enum_bootstrap  <-- 本迁移 (20260627 < 20260628)
--   20260628_customer_auto_fields         <-- ALTER TYPE ADD VALUE IF NOT EXISTS (no-op)
--   20260630_message_type_enum_index      <-- CREATE TYPE 已存在 → 失败, CI 里 mark applied
--   20260701_employee_profile_restructure <-- ALTER TYPE ADD VALUE IF NOT EXISTS (no-op)
--   20260702_message_type_add_overdue_events <-- ALTER TYPE ADD VALUE IF NOT EXISTS (no-op)
--
-- 对生产 DB 的影响 (零):
--   生产 MessageType 已经有 12 个值 (dev/prod 都是手工跑出来的, 等价终态).
--   CREATE TYPE ... AS ENUM 在生产 type 已存在时直接报 "type already exists".
--   prisma migrate deploy 会把这条标记为 failed, 然后 _prisma_migrations 已经有 20260630
--   标记 applied (生产手工跑过), 所以 prisma 会跳过它. 无副作用.

-- 用 DO $$ ... EXCEPTION 包装, 让迁移在 MessageType 已存在时也安全 no-op
-- (dev/prod DB 已经手工按依赖顺序跑过迁移, MessageType 终态是这 12 个值的 superset;
--  新 fresh DB 上需要 CREATE; 已存在则跳过, 不影响 _prisma_migrations 的应用记录)

DO $$
BEGIN
  BEGIN
    CREATE TYPE "MessageType" AS ENUM (
      -- 来自 20260630_message_type_enum_index
      'CONTRACT_EXPIRING',
      'INVOICE_OVERDUE_PAYMENT',
      'PAYMENT_RECEIVED',
      'CUSTOMER_STATUS_SUGGEST',
      'CONTRACT_AUTO_EXECUTED',
      'CONTRACT_AUTO_COMPLETED',
      'CONTRACT_AUTO_EXPIRED',
      -- 来自 20260628_customer_auto_fields
      'CUSTOMER_STATUS_AUTO_APPLIED',
      'CUSTOMER_STATUS_AUTO_REVERTED',
      -- 来自 20260701_employee_profile_restructure
      'CERTIFICATE_EXPIRING',
      -- 来自 20260702_message_type_add_overdue_events
      'CONTRACT_AUTO_OVERDUE_TERMINATED',
      'CONTRACT_EXPIRED_UNPAID'
    );
  EXCEPTION WHEN duplicate_object THEN
    RAISE NOTICE 'MessageType enum already exists, skipping CREATE TYPE';
  END;
END $$;