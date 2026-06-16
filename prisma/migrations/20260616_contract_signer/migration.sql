-- AlterTable
ALTER TABLE "Contract" ADD COLUMN "signerId" TEXT;

-- Backfill: existing rows use createdById as signer (likely matches business reality)
UPDATE "Contract" SET "signerId" = "createdById" WHERE "signerId" IS NULL;

-- Make non-null now that backfill is done
ALTER TABLE "Contract" ALTER COLUMN "signerId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Contract_signerId_idx" ON "Contract"("signerId");

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_signerId_fkey" FOREIGN KEY ("signerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
