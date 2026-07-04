-- 合同 legacy-fineui 迁移时的 0.01 占位合同标记
--
-- 背景: scripts/migrate/legacy-fineui.mjs (E_CONTRACT_PROJECT 阶段, 约 145 条) 把 FineUI 旧系统
--       ContractAmount<=0 的合同 totalAmount 写成 0.01 占位值, 用来绕过当前 schema 的 totalAmount>0 校验.
--       这些合同不是真实 1 分钱合同 (税=0.00, 不含税=0.01, 合同额 0.01 暂未上报财务的"乱账"),
--       需要在统计聚合时排除, 业务列表/详情默认隐藏(给运维显式 opt-in).
--
-- 字段语义:
--   false (默认) = 真实业务合同
--   true         = legacy-fineui.mjs 把 0/空/负数 写成的 0.01 占位合同, 报表/统计/列表默认排除
--
-- 迁移: 一次性回填所有 totalAmount=0.01 且未删除的合同为 true, 脚本不幂等会报错, 但可以重复执行(回填条件有 AND false).
--       注意: 业务侧可能存在真实的 0.01 合同 (按当前 schema 合法, 走真实付款), 上线前应先按
--       docs/db-bootstrap.md 第 2 节推荐的"先备份"的方式人工核对一次.
ALTER TABLE "Contract" ADD COLUMN "isLegacyZeroAmount" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Contract"
   SET "isLegacyZeroAmount" = true
 WHERE "totalAmount" = 0.01
   AND "deletedAt" IS NULL
   AND "isLegacyZeroAmount" = false;

-- 索引: dashboard/统计聚合 where isLegacyZeroAmount=false 会每次都走, 没索引会全表扫描
CREATE INDEX "Contract_isLegacyZeroAmount_idx" ON "Contract"("isLegacyZeroAmount");

-- 防御性 GRANT (v0.7.0 DunningNote 漏 GRANT 教训): ALTER 不会改表级权限,
-- 写表的用户没 GRANT 就 INSERT/UPDATE 报 42501, 这个脚本成本几乎为 0 顺手补上,
-- 符合 v0.7.0 之后"新表一律 GRANT"的约束.
GRANT ALL ON TABLE "Contract" TO qt_app;