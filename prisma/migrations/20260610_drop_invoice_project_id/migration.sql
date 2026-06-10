-- Drop Invoice.projectId 关系:开票改为只关联合同,不再强绑项目

-- 1) RLS 策略改写:SALES 行级隔离由 project→contract 改为直接 contract
DROP POLICY IF EXISTS invoice_sales_isolation ON "Invoice";

CREATE POLICY invoice_sales_isolation ON "Invoice"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR
    current_setting('app.user_role', true) IN ('ADMIN', 'FINANCE', 'OPS')
    OR
    (
      current_setting('app.user_role', true) = 'SALES'
      AND EXISTS (
        SELECT 1 FROM "Contract" c
        WHERE c.id = "Invoice"."contractId"
          AND c."ownerUserId" = current_setting('app.user_id', true)
      )
    )
  );

-- 2) DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_projectId_fkey";

-- 3) DropIndex
DROP INDEX "Invoice_projectId_idx";

-- 4) AlterTable
ALTER TABLE "Invoice" DROP COLUMN "projectId";
