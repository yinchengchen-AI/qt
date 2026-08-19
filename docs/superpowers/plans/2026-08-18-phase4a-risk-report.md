# Phase 4a 规则引擎风险报告 — 实现计划

> 日期：2026-08-18
> Spec：`docs/superpowers/specs/2026-08-18-contract-deepening-roadmap-design.md` §7.1 第一层 / §7.2 输出契约 / §7.3 展示位置
> 前置：Phase 2 风险引擎（v0.20.4）已交付评分 + 快照；Phase 3 详情页增强已上线
> 提交计划：单个 `feat(risk): 规则引擎风险报告` commit + `npm version patch` + CHANGELOG（不 push 不部署）

## 范围（严格按 spec §7，4b LLM 不在本期）

1. **报告构建器** `server/services/contract/risk-report.ts`（纯函数，无外部依赖）：
   - 输出契约对齐 §7.2：`{ contractId, riskScore, riskLevel, asOf, dimensions, weightedScore, recommendations[], trend, trendSummary }`
   - `weightedScore`：公式字符串 `"67×0.30 + 80×0.25 + 60×0.20 + 33×0.15 + 0×0.10 = 57.1 → 四舍五入 57"`（用各维度未取整原始分验算）
   - `recommendations[]`：按维度得分降序取 ≥50 分的维度生成（Top 2-3），文案带业务数据（催款带剩余金额、逾期带宽限期倒数、开票带缺口）；trend 上升 ≥10 分时追加一条趋势建议；无高风险维度时给常规跟进建议
   - `trendSummary { days, from, to, mainDriver }`：mainDriver = 窗口内各维度得分增量最大者（读快照 dimensions JSON）；快照 < 2 个时为 null（UI 显示「数据积累中」，spec §12）
2. **数据扩展**：`computeContractRisks` 结果带上 `totalAmount / paidAmount / invoicedAmount / daysOverdue`（聚合 map 已有，透出即可，不新增查询）
3. **API**：`getContractRisk` 改走报告构建器，响应在现有字段（score/level/dimensions/trend 数组/recommendations）上追加 `weightedScore / trendSummary / asOf / mainDriver`，`recommendations` 升级为多条（抽屉已按数组渲染，向后兼容）
4. **前端**：
   - 从 `risk-drawer.tsx` 抽取 `RiskReportView` 共享组件（雷达 + 维度明细 + 公式 + 建议列表 + 趋势折线），抽屉与详情页复用
   - 详情页概览 tab 新增「风险分析」ProCard 区块（不新增 Tab，与 Phase 3 一致）：等级 Tag + 分数 + RiskReportView
5. **测试**：
   - 单测 `tests/unit/server/risk-report.test.ts`：§7.2 示例验算（公式串逐字符比对）、mainDriver 判定、recommendations 内容与排序、快照 <2 时 trendSummary=null
   - API：`getContractRisk` 返回报告字段（含 weightedScore 格式、recommendations 多条）
   - E2E `tests/e2e/19-risk-report.spec.ts`：详情页风险分析区块渲染（等级/雷达/趋势或积累提示）
6. **验证**：typecheck + lint + vitest + E2E 三 project

## 明确不做（本期）
- LLM 摘要 / 话术建议（Phase 4b，单独评审）
- 工作台每日简报；雷达图移动端降级条形图（Phase 5 统一处理）
