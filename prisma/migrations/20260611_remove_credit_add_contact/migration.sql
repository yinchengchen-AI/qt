-- AlterTable
ALTER TABLE "Customer" 
  DROP COLUMN "creditLimitAmount",
  DROP COLUMN "paymentTermDays",
  DROP COLUMN "contactEmail",
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "contactTitle" TEXT;
