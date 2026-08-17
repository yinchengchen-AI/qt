-- 下线对账规则配置（ReconciliationRule）
--   背景: v0.20.0 引入的规则 DSL 从未接线 —— 匹配引擎不读它, 前端无配置入口,
--         表/CRUD API/service 全属死代码; DSL 本身也是拍脑袋设计
--   决策: 整表下线; 将来若做可视化规则, 按彼时需求重新设计
DROP TABLE "ReconciliationRule";
