# Phase 2 合同风险预警引擎 — 实现计划

> 日期：2026-08-18
> Spec：`docs/superpowers/specs/2026-08-18-contract-deepening-roadmap-design.md` §5（已批准 v2）
> 前置：Phase 1 工作台已上线（v0.20.3）
> 提交计划：单个 `feat(risk): ...` commit + `npm version patch` + CHANGELOG

## 范围（严格按 spec §5，不扩）

1. 两个迁移：`RiskScoreSnapshot` 新表（+GRANT qt_app）、`MessageType.RISK_LEVEL_UP` 枚举值
2. 评分服务 `server/services/contract/risk-score.ts`：五维度分段函数（纯函数）+ 批量预聚合计算
3. 每日快照 job `risk-score-snapshot` 挂入 `runAllJobs`：幂等 upsert + 升档检测发 `RISK_LEVEL_UP`
4. `bus.ts#buildMessage` 新增 `RISK_LEVEL_UP` 渲染分支
5. my-stats 风险卡从占位 "—" 改为真实计数（HIGH+CRITICAL）
6. API：`GET /api/contracts/my-risk`（我的 MEDIUM+ 风险合同列表）、`GET /api/contracts/[id]/risk`（单合同风险详情 + 30 天趋势 + 建议）
7. 前端：工作台风险卡真实计数 + 点击开风险抽屉（列表 → 详情：雷达图 + 趋势 + 建议）；我的合同表加风险标签列
8. 测试：分段函数边界单测、快照幂等、升档去重、API 权限、迁移回归、E2E 风险卡

## 关键口径锁定（spec §5.1 的边界补全）

- **未开始合同**（now < startDate）：t=0，付款/开票维度自然 0 分，无特殊分支（spec 原文）
- **totalAmount ≤ 0**（无价/占位合同）：付款/开票维度按 p=i=1 处理得 0 分；金额异常维度的客户均值只统计 totalAmount>0 的合同，均值=0 时得 0 分
- **totalDays ≤ 0**（startDate ≥ endDate 脏数据）：clamp 为 1 天防除零；t = clamp(elapsed/totalDays, 0, 1)
- **客户信用**：样本 = 该客户全部非删除合同（不限状态）；< 3 份固定 20 分；rate = 强关数（CLOSED + reviewComment="overdue_terminated"）/ 总数
- **金额异常**：样本 = 该客户 totalAmount>0 的非删除合同；< 3 份得 0 分；r = |amount-mean|/mean，r≤0.5→0，r≥2→100，中间线性
- **等级**：`Math.round(加权总分)`；0-30 LOW / 31-60 MEDIUM / 61-80 HIGH / 81-100 CRITICAL；等级序 LOW=0 < MEDIUM=1 < HIGH=2 < CRITICAL=3
- **快照**：snapshotDate = 当日 00:00；`@@unique([contractId, snapshotDate])` upsert 幂等
- **升档**：今日等级序 > 昨日且今日 ∈ {HIGH, CRITICAL} → 发消息；entityKey = `RISK_LEVEL_UP:{contractId}:{level}:{yyyy-MM-dd}`（同日同档去重；降档再升档会重发，有意为之）
- **admin 汇总**：job 完成后若 HIGH+CRITICAL > 0，给全部 admin 发一条汇总，同 type，entityKey = `RISK_LEVEL_UP:SUMMARY:{yyyy-MM-dd}`

## Task 拆分（TDD）

### Task 1：迁移 + schema
- `prisma/schema.prisma`：加 `RiskScoreSnapshot` model + `MessageType.RISK_LEVEL_UP`
- 两个迁移文件：
  - `<ts>_risk_score_snapshot`：CREATE TABLE + `@@unique` + `@@index([snapshotDate, level])` + 外键 + `GRANT ALL ON TABLE "RiskScoreSnapshot" TO qt_app;`
  - `<ts>_message_type_risk_level_up`：参照 `20260724_message_type_paid_invoice_pending` 模式 `ALTER TYPE ... ADD VALUE IF NOT EXISTS`
- 回归测试：参照 `tests/milestones-removed.test.ts` 补 schema 存在性断言

### Task 2：评分纯函数 + 单测
- `server/services/contract/risk-score.ts`：
  - `computeDimensions(input)` → 五维度原始分 + detail 文案
  - `computeRiskScore(input)` → { score, level, dimensions }
  - 常量 `RISK_LEVEL_ORDER`、维度权重表
- `tests/unit/server/risk-score.test.ts`：逐维度边界（d=0/30/60；t=0；t-p<0；样本<3；r=0.5/2；四舍五入；等级边界 30/31/60/61/80/81）

### Task 3：批量计算 + 快照 job + 升档消息
- `computeContractRisks(contracts, now)`：三次 groupBy/findMany 预聚合（payment、invoice、客户历史合同一次 findMany 后 JS 分组），禁 N+1
- `server/jobs/risk-score-snapshot.ts`：全量 ACTIVE → 批量算分 → upsert 今日快照 → 查昨日快照比对升档 → emit `RISK_LEVEL_UP`（owner+admin）→ admin 汇总一条
- `runner.ts` 注册 `risk-score-snapshot`
- `bus.ts` buildMessage 加分支（link: { kind: "contract", id }）
- `tests/api/contract-risk.test.ts`：快照幂等（跑两遍行数不变）、升档消息只发一次、降档不发、汇总去重

### Task 4：API + my-stats 真实计数
- `GET /api/contracts/my-risk`：requireSession → 我的 ACTIVE → 批量算分 → 过滤 MEDIUM+ 降序
- `GET /api/contracts/[id]/risk`：requireSession → getContract(user, id) 复用行级权限 → 单合同算分 + 近 30 天快照 + 建议（最高分维度映射：expiry→续签/归档，payment→催款，invoicing→去开票，customerCredit→缩短账期，amountAnomaly→复核金额）
- `workbench.ts#getMyStats`：risk 字段改为真实 HIGH+CRITICAL 计数（复用批量算分，不另查）
- 测试：越权 403（他人合同 risk 详情）、my-risk 只含本人、my-stats.risk 与列表一致

### Task 5：前端
- `components/workbench/risk-drawer.tsx`：风险列表抽屉（MEDIUM+ 列表 + 等级 Tag）→ 点行进详情（Radar 五维雷达 + Line 30 天趋势 + 维度明细 + 建议列表）；快照 < 2 个点时趋势区显示「数据积累中」（spec §12）
- 工作台页：风险卡真实计数 + 点击开抽屉；SWR 拉 my-risk 建 contractId→level 映射，我的合同表加「风险」列（MEDIUM 黄 / HIGH 橙 / CRITICAL 红，LOW 不显示）
- E2E `tests/e2e/17-contract-risk.spec.ts`：风险卡可见、抽屉打开、移动端布局

## 验证
`npm run typecheck && npm run lint && npm test` 全绿后提交。

## 明确不做（本期）
- 风险趋势 dashboard 图表（Phase 4a 报告页再做完整报告）
- LLM 摘要（Phase 4b）
- 降档消息、实时评分与快照差异对账（spec §5.4 明确不处理）
- 合同列表页（非工作台）的风险列（避免动通用 listContracts 批量成本，后续按需）
