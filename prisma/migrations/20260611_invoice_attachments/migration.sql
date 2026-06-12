-- DropIndex
DROP INDEX "ProjectProgressLog_projectId_idx";

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "invoiceId" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_invoiceId_deletedAt_idx" ON "Attachment"("invoiceId", "deletedAt");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
