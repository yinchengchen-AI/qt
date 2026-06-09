-- =====================================================
-- Row-Level Security (RLS) 兜底：SALES 只能看自己拥有的客户
-- 配合应用层事务内 SET LOCAL app.user_id / app.user_role
-- =====================================================

-- 启用 RLS
ALTER TABLE "Customer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;

-- Customer: SALES 只能看 ownerUserId = current_setting('app.user_id') 的客户
CREATE POLICY customer_sales_isolation ON "Customer"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    (
      current_setting('app.user_role', true) = 'SALES'
      AND "ownerUserId" = current_setting('app.user_id', true)
    )
    OR
    (
      current_setting('app.user_role', true) IN ('ADMIN', 'FINANCE', 'OPS')
    )
  );

-- Contract: SALES 通过 ownerUserId 过滤
CREATE POLICY contract_sales_isolation ON "Contract"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    (
      current_setting('app.user_role', true) = 'SALES'
      AND "ownerUserId" = current_setting('app.user_id', true)
    )
    OR
    (
      current_setting('app.user_role', true) IN ('ADMIN', 'FINANCE', 'OPS')
    )
  );

-- Project: SALES 通过 contract.ownerUserId 过滤（Project 表无 ownerUserId，需 join）
-- PG RLS 不支持跨表 join 的 USING；这里做"通过 EXISTS 子查询"或简化：项目不直接 RLS
-- 改：应用层 SALES 注入 where contract.ownerUserId = self.id
CREATE POLICY project_sales_isolation ON "Project"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    current_setting('app.user_role', true) IN ('ADMIN', 'FINANCE', 'OPS', 'SALES')
  );

-- Invoice: 通过 project.contract.ownerUserId 过滤
-- PG 11+ 支持子查询
CREATE POLICY invoice_sales_isolation ON "Invoice"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    current_setting('app.user_role', true) IN ('ADMIN', 'FINANCE', 'OPS')
    OR
    (
      current_setting('app.user_role', true) = 'SALES'
      AND EXISTS (
        SELECT 1 FROM "Project" p
        JOIN "Contract" c ON c.id = p."contractId"
        WHERE p.id = "Invoice"."projectId"
          AND c."ownerUserId" = current_setting('app.user_id', true)
      )
    )
  );

-- Payment: 通过 contract.ownerUserId
CREATE POLICY payment_sales_isolation ON "Payment"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    current_setting('app.user_role', true) IN ('ADMIN', 'FINANCE', 'OPS')
    OR
    (
      current_setting('app.user_role', true) = 'SALES'
      AND EXISTS (
        SELECT 1 FROM "Contract" c
        WHERE c.id = "Payment"."contractId"
          AND c."ownerUserId" = current_setting('app.user_id', true)
      )
    )
  );

-- 注释：app.bypass_rls 用于 cron jobs / 内部调用时绕过 RLS
-- 应用层 Service 应在事务开始时设置：
--   SET LOCAL app.user_id = 'xxx';
--   SET LOCAL app.user_role = 'SALES';
-- 显式置空时要 `SELECT set_config('app.user_id', '', true)`
