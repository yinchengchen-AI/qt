-- AgingSnapshot 应收账龄日快照 (预计算表)
--   用途: 账龄趋势图 O(1) 读取, 替代每次请求对全量 ISSUED 发票+回款重算 N 天
--   口径: 全局 (不限 owner), 与 getInvoiceAging(basis) 一致;
--         受限角色 (SALES/EXPERT) 读取时在 service 层回退实时计算
--   cron job (server/jobs/aging-snapshot.ts) 每日幂等 upsert 近 30 天
CREATE TABLE "AgingSnapshot" (
    "id"              TEXT        NOT NULL,
    "asOfDate"        DATE        NOT NULL,
    "basis"           TEXT        NOT NULL,
    "bucket0_30"      DECIMAL(18, 2) NOT NULL DEFAULT 0,
    "bucket31_60"     DECIMAL(18, 2) NOT NULL DEFAULT 0,
    "bucket61_90"     DECIMAL(18, 2) NOT NULL DEFAULT 0,
    "bucket90"        DECIMAL(18, 2) NOT NULL DEFAULT 0,
    "totalReceivable" DECIMAL(18, 2) NOT NULL DEFAULT 0,
    "invoiceCount"    INTEGER     NOT NULL DEFAULT 0,
    "createdAt"       TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(6) WITH TIME ZONE NOT NULL,

    CONSTRAINT "AgingSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgingSnapshot_asOfDate_basis_key" ON "AgingSnapshot"("asOfDate", "basis");
CREATE INDEX "AgingSnapshot_basis_asOfDate_idx" ON "AgingSnapshot"("basis", "asOfDate");

-- AGENTS.md 强制要求: 新表必须显式 GRANT 给 qt_app (BYPASSRLS 不旁路表级权限)
GRANT ALL ON TABLE "AgingSnapshot" TO qt_app;
