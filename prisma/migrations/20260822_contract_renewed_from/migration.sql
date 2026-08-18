-- Contract.renewedFromId 续签链路 (Phase 1.5)
--   用途: 新合同标记"续签自哪个合同"; NULL = 非续签。不加 RENEWED 状态,
--         源合同走既有自动完结/强关路径 (spec §4.1, 状态机零改动)
--   FK ON DELETE SET NULL: 合同正常只软删; 测试硬删 fixture 时不阻塞清理
ALTER TABLE "Contract" ADD COLUMN "renewedFromId" TEXT;

ALTER TABLE "Contract" ADD CONSTRAINT "Contract_renewedFromId_fkey"
  FOREIGN KEY ("renewedFromId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Contract_renewedFromId_idx" ON "Contract"("renewedFromId");
