-- 应收账龄重设计
--   1) Invoice.dueDate: 合同约定付款日(可空);为 null 时按 actualIssueDate 计龄
--   2) DunningNote: 催收记录(status / promisedDate / channel / remark)
--   3) 索引: dueDate 单列 + DunningNote(invoiceId, status) 复合
--   4) 回填: ISSUED 且 dueDate 为空的发票,默认 actualIssueDate + 30 天
--      (其它状态保持 NULL,等用户后续录入或财务在开票审核时补)
--
-- 与 AGENTS.md "不可变迁移" 规则一致:不动历史 migration,本迁移只新增对象。

BEGIN;

-- AlterTable
ALTER TABLE "Invoice"
  ADD COLUMN "dueDate" TIMESTAMPTZ(6);

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateTable
CREATE TABLE "DunningNote" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "promisedDate" TIMESTAMPTZ(6),
  "lastContactAt" TIMESTAMPTZ(6) NOT NULL,
  "channel" TEXT NOT NULL,
  "remark" TEXT,
  "actorId" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DunningNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DunningNote_invoiceId_idx" ON "DunningNote"("invoiceId");
CREATE INDEX "DunningNote_status_idx" ON "DunningNote"("status");

-- AddForeignKey
ALTER TABLE "DunningNote" ADD CONSTRAINT "DunningNote_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DunningNote" ADD CONSTRAINT "DunningNote_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 索引补充:催收审计查询 "按 actor + createdAt"
CREATE INDEX "DunningNote_actorId_createdAt_idx" ON "DunningNote"("actorId", "createdAt");

-- Backfill
UPDATE "Invoice"
   SET "dueDate" = "actualIssueDate" + INTERVAL '30 days'
 WHERE "dueDate" IS NULL
   AND "actualIssueDate" IS NOT NULL
   AND "status" = 'ISSUED'
   AND "deletedAt" IS NULL;

COMMIT;
