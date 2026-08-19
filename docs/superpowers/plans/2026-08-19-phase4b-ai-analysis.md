# Phase 4b LLM 增强（DeepSeek）— 实现计划

> 日期：2026-08-19
> Spec：`docs/superpowers/specs/2026-08-18-contract-deepening-roadmap-design.md` §7.1 第二层
> 决策：服务商 DeepSeek（用户拍板 2026-08-19），key 仅入本地 `.env`（gitignored），`lib/env.ts` 校验，不落库不前端可见
> 已验证：`POST https://api.deepseek.com/chat/completions` + `deepseek-chat` 真实调用成功
> 提交计划：单个 `feat(ai): ...` commit + `npm version patch` + CHANGELOG（不 push 不部署；key 不入库）

## 范围（spec §7.1 第二层核心：自然语言摘要 + 跟进话术；条款 OCR 单独立项不在本期）

1. **配置**：`DEEPSEEK_API_KEY`（可选，无 key 时服务降级为明确 503 而非伪装结果）、`DEEPSEEK_BASE_URL`（默认 `https://api.deepseek.com`）、`DEEPSEEK_MODEL`（默认 `deepseek-chat`）；`.env.example` 加占位
2. **`server/services/contract-ai.ts`**：
   - `analyzeContractRisk(report)`：构造结构化 prompt（合同号/客户/金额/日期/五维度得分与明细/建议/趋势），要求 JSON 输出 `{ summary, talkTracks[] }`
   - 防泄漏：错误信息不带 key；`AbortSignal.timeout(20s)`；401→配置错误、429→限流、5xx→上游错误，统一 ApiError 502/503
   - 数据出域最小化：只发风险报告字段（合同号/客户名/金额/评分），不发联系人/电话/身份证号等个人敏感字段
3. **API**：`GET /api/contracts/[id]/ai-analysis`（薄壳：requireSession → getContractRisk 复用行级读权限 → analyzeContractRisk → ok/err）
4. **前端**：`RiskReportView` 底部加「AI 分析」区（按钮触发生成，不自动调——省 token；生成中 loading；结果 = 摘要段落 + 话术列表；失败显示可重试错误态）。抽屉与详情页共用自动获得
5. **测试**：
   - 单测 `tests/unit/server/contract-ai.test.ts`：mock global fetch——prompt 结构（含报告字段、要求 JSON）、正常解析、超时/401/429/5xx 错误映射、无 key 时 503
   - API 测试：mock fetch 下路由返回结构；无 key 503
   - 真实 smoke：本地手动 curl 一次（不进自动化测试，防 key 依赖）
6. **E2E**：详情页 AI 分析区可见「生成 AI 分析」按钮（dev 无 key → 点击后显示降级错误信息，不白屏）

## 明确不做（本期）
- 条款合规检查（需条款文本 + 附件 OCR，spec 注明单独立项）
- 结果缓存/计费统计（v1 按需点击，后续看用量再加）
- Web Push / 移动端专项（Phase 5 已覆盖响应式）
