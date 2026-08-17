-- 发票与回款自动对账匹配 (Bank Reconciliation)
--   用途: 银行流水导入 + 自动匹配引擎 + 对账差异处理
--   设计文档: docs/architecture/DESIGN-v3.md §对账中心

-- =====================================================
-- 1. BankTransaction: 银行流水原始记录
-- =====================================================
CREATE TABLE "BankTransaction" (
    "id"                TEXT        NOT NULL,
    -- 银行流水号 + 交易日期 + 金额 联合唯一, 防重复导入
    "bankRefNo"         TEXT        NOT NULL,
    "transactionDate"   TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    "amount"            DECIMAL(18, 2) NOT NULL,
    "currency"          TEXT        NOT NULL DEFAULT 'CNY',
    -- 对方信息
    "counterpartyName"  VARCHAR(200),
    "counterpartyAccount" VARCHAR(100),
    "counterpartyBank"  VARCHAR(100),
    -- 摘要与用途
    "summary"           VARCHAR(500),
    "purpose"           VARCHAR(500),
    -- 导入批次
    "importBatchId"     TEXT        NOT NULL,
    "importedById"      TEXT        NOT NULL,
    "importedAt"        TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- 对账状态: UNMATCHED → AUTO_MATCHED → CONFIRMED_MATCHED → MANUAL_MATCHED → IGNORED
    "matchStatus"       TEXT        NOT NULL DEFAULT 'UNMATCHED',
    "matchedAt"         TIMESTAMP(6) WITH TIME ZONE,
    "matchedById"       TEXT,
    -- 匹配结果
    "paymentId"         TEXT,
    "matchScore"        DECIMAL(5, 2),
    "matchReason"       VARCHAR(200),
    -- 审计
    "createdAt"         TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(6) WITH TIME ZONE NOT NULL,
    "deletedAt"         TIMESTAMP(6) WITH TIME ZONE,

    CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BankTransaction_bankRefNo_transactionDate_amount_key"
    ON "BankTransaction"("bankRefNo", "transactionDate", "amount");
CREATE INDEX "BankTransaction_matchStatus_transactionDate_idx"
    ON "BankTransaction"("matchStatus", "transactionDate");
CREATE INDEX "BankTransaction_amount_idx" ON "BankTransaction"("amount");
CREATE INDEX "BankTransaction_counterpartyName_idx" ON "BankTransaction"("counterpartyName");
CREATE INDEX "BankTransaction_importBatchId_idx" ON "BankTransaction"("importBatchId");
CREATE INDEX "BankTransaction_paymentId_idx" ON "BankTransaction"("paymentId");

-- AGENTS.md 强制要求: 新表必须显式 GRANT 给 qt_app
GRANT ALL ON TABLE "BankTransaction" TO qt_app;

-- =====================================================
-- 2. ReconciliationRule: 对账规则配置
-- =====================================================
CREATE TABLE "ReconciliationRule" (
    "id"          TEXT        NOT NULL,
    "name"        VARCHAR(100) NOT NULL,
    "priority"    INTEGER     NOT NULL DEFAULT 0,
    "isActive"    BOOLEAN     NOT NULL DEFAULT true,
    -- 匹配条件 JSON DSL: { amountTolerance, dateWindowDays, counterpartyKeywords, ... }
    "conditions"  JSONB       NOT NULL,
    -- 动作: AUTO_MATCH | SUGGEST_MATCH | FLAG_REVIEW
    "action"      TEXT        NOT NULL,
    "createdById" TEXT        NOT NULL,
    "createdAt"   TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(6) WITH TIME ZONE NOT NULL,

    CONSTRAINT "ReconciliationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReconciliationRule_isActive_priority_idx" ON "ReconciliationRule"("isActive", "priority");

GRANT ALL ON TABLE "ReconciliationRule" TO qt_app;

-- =====================================================
-- 3. ReconciliationDiscrepancy: 对账差异记录
-- =====================================================
CREATE TABLE "ReconciliationDiscrepancy" (
    "id"                TEXT        NOT NULL,
    -- 差异类型: AMOUNT_MISMATCH | DUPLICATE_REF | UNMATCHED_TRANSACTION | OVER_PAYMENT | UNDER_PAYMENT
    "type"              TEXT        NOT NULL,
    "severity"          TEXT        NOT NULL DEFAULT 'MEDIUM',
    -- 关联实体
    "bankTransactionId" TEXT,
    "paymentId"         TEXT,
    "invoiceId"         TEXT,
    -- 差异详情
    "expectedAmount"    DECIMAL(18, 2),
    "actualAmount"      DECIMAL(18, 2),
    "difference"        DECIMAL(18, 2),
    "description"       VARCHAR(1000) NOT NULL,
    "resolution"        VARCHAR(1000),
    "resolvedAt"        TIMESTAMP(6) WITH TIME ZONE,
    "resolvedById"      TEXT,
    "status"            TEXT        NOT NULL DEFAULT 'OPEN',
    "createdAt"         TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(6) WITH TIME ZONE NOT NULL,

    CONSTRAINT "ReconciliationDiscrepancy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReconciliationDiscrepancy_status_severity_idx" ON "ReconciliationDiscrepancy"("status", "severity");
CREATE INDEX "ReconciliationDiscrepancy_type_idx" ON "ReconciliationDiscrepancy"("type");

GRANT ALL ON TABLE "ReconciliationDiscrepancy" TO qt_app;

-- =====================================================
-- 4. 扩展 MessageType enum: 对账相关通知
-- =====================================================
-- 注意: PostgreSQL ALTER TYPE ... ADD VALUE 是即时生效的, 但旧版本 PG 有使用限制
-- 当前 MessageType 是原生 enum, 需要 ALTER TYPE 添加新值
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_AUTO_MATCHED';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_SUGGESTION';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_DISCREPANCY';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_WEEKLY_REPORT';
