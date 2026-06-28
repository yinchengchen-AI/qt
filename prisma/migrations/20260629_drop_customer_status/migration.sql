-- =====================================================
-- 客户状态机下线: 删 Customer.status / lastAutoAppliedAt / lastAutoRule
-- 配合 spec 2026-06-29-customer-status-deprecation.md §2.1
-- =====================================================

DROP INDEX IF EXISTS "Customer_status_idx";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "status";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "lastAutoAppliedAt";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "lastAutoRule";
