-- 应收账龄数据质量治理
--   新增 InvoiceDataQualityIssue, 记录发票级数据质量问题。
--   由 scripts/data-quality/classify-invoice-dq.ts 幂等写入;
--   账龄统计读取 OPEN 且属于隔离口径的问题行, 将其金额从主口径隔离并单独返回。

BEGIN;

-- AgingSnapshot 增加数据质量隔离字段, 用于趋势图保留"待治理金额"而不直接丢弃。
ALTER TABLE "AgingSnapshot"
    ADD COLUMN "dataQualityExcluded" DECIMAL(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE "AgingSnapshot"
    ADD COLUMN "dataQualityInvoiceCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "InvoiceDataQualityIssue" (
    "id"         TEXT NOT NULL,
    "invoiceId"  TEXT NOT NULL,
    "issueCode"  TEXT NOT NULL,
    "detail"     TEXT,
    "status"     TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(6) WITH TIME ZONE,
    "createdAt"  TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(6) WITH TIME ZONE NOT NULL,

    CONSTRAINT "InvoiceDataQualityIssue_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvoiceDataQualityIssue_invoiceId_issueCode_key"
    ON "InvoiceDataQualityIssue"("invoiceId", "issueCode");

CREATE INDEX "InvoiceDataQualityIssue_invoiceId_idx"
    ON "InvoiceDataQualityIssue"("invoiceId");

CREATE INDEX "InvoiceDataQualityIssue_issueCode_status_idx"
    ON "InvoiceDataQualityIssue"("issueCode", "status");

ALTER TABLE "InvoiceDataQualityIssue"
    ADD CONSTRAINT "InvoiceDataQualityIssue_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AGENTS.md 强制要求: 新表必须显式 GRANT 给 qt_app。
GRANT ALL ON TABLE "InvoiceDataQualityIssue" TO qt_app;

COMMIT;
