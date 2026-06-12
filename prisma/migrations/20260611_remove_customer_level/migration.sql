-- AlterTable
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "level";
DROP INDEX IF EXISTS "Customer_level_idx";
