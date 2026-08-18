# Phase 1.5 续签跟进 + Phase 3 联动自动化补盲 — 实现计划

> 日期：2026-08-18
> Spec：`docs/superpowers/specs/2026-08-18-contract-deepening-roadmap-design.md` §4 / §6（已批准 v2）
> 前置：Phase 1 工作台（v0.20.3）、Phase 2 风险引擎（v0.20.4）已上线
> 提交计划：`feat(renewal): ...` + `feat(linkage): ...` 两个 commit，收束一次 `npm version patch` + CHANGELOG

## Phase 1.5 范围（spec §4）

1. **迁移**：`Contract.renewedFromId`（TEXT + FK `ON DELETE SET NULL` + 索引；自关联 `ContractRenewal`）；`MessageType` += `CONTRACT_RENEWAL_REMIND`
2. **续签提醒 job** `contract-renewal-remind` 挂入 `runAllJobs`：
   - 判定：`ACTIVE 且 endDate < now-30d`（到期超 30 天）且不存在 `renewedFromId=该合同` 的有效续签合同
   - entityKey = `CONTRACT_RENEWAL_REMIND:{contractId}:{ISO yyyy-Www}`（同周去重；job 内先做"本周已发"第一道过滤，skipDuplicates 兜底）
   - 接收人：owner + admin；bus.ts buildMessage 加分支
3. **创建链路**：`contractCreateSchema` += `renewedFromId?`；service 校验（存在、未删、非自身）+ 持久化 + 审计 after 快照带上
4. **待办收口**：`getMyTodos` 对 overdue/expiring 待办排除已续签合同（一次 findMany 预取 renewal 集合，禁 N+1）
5. **前端**：待办列表 overdue/expiring 项旁「续签」按钮 → `RenewalModal`（预填客户/服务类型/金额/税率/付款方式/备注，日期默认 原endDate+1 起同跨度，均可编辑；contractNo 手填）→ `POST /api/contracts`（走正常 DRAFT 流程，不绕过审批）→ 成功后 SWR mutate 待办（该项消失）
6. **测试**：`tests/api/contract-renewal.test.ts`（30 天判定 / 周去重 / 已续签跳过 / 创建带 renewedFromId / 越权校验 / todo 消失）；schema 回归补 `renewedFromId`

## Phase 3 范围（spec §6）

1. **迁移**：`MessageType` += `LINKAGE_NO_INVOICE` + `LINKAGE_INVOICE_PAYMENT_GAP`
2. **共享判定模块** `server/services/contract/linkage-checks.ts`（job 与 overview 同源，防口径漂移）：
   - 超期未开票：`ACTIVE 且 startDate <= now-30d 且无已开票发票`（INVOICE_ISSUED_AMOUNT_STATUSES 口径）
   - 开票-回款偏差：`已开票 >= 1 万 且 (已开票-已回款)/已开票 > 20% 且最新发票 actualIssueDate <= now-30d`
3. **job** `daily-linkage-check` 挂入 `runAllJobs`：两条检查各按 entityKey `{TYPE}:{contractId}:{yyyy-MM-dd}` 日去重；接收人 超期未开票→owner、偏差→owner+财务
4. **详情页增强**（不新增 Tab）：
   - `getContractOverview` 透出 `warnings: { noInvoice, invoicePaymentGap }`（复用共享判定）+ `renewedFrom {id,contractNo} | null` + `renewals [{id,contractNo,status}]`
   - 详情页概览区：开票/回款双进度条（totals 已有金额，前端算比率）；有预警时顶部 Alert 锚跳对应列表；有续签链时显示「续签自 / 续签至」链接
5. **测试**：`tests/api/linkage-check.test.ts`（两条检查阈值边界 + 日去重 + overview warnings 透出）；R-08/R-12 回归由现有测试覆盖
6. **E2E**：`tests/e2e/18-renewal-linkage.spec.ts` — 待办点续签 → Modal 预填 → 创建成功 → 待办消失；详情页双进度条渲染

## 关键口径锁定

- **续签判定不影响原合同状态机**：原合同仍走既有自动完结/强关；不加 RENEWED 状态（spec §4.1 明确）
- **续签创建不绕过审批**：复用 POST /api/contracts → DRAFT →（字段完整+附件→tryAutoPublish）→ 正常流转
- **renewedFromId 写守门**：非 admin 创建的合同 owner=创建人；renewedFromId 只校验存在性，谁发起续签谁拥有新合同（与销售转交流程不冲突）
- **待办排除范围**：已续签合同只排除 overdue/expiring 待办；no_invoice 不关联续签语义，保留
- **偏差检查口径**：金额比较走 Prisma.Decimal + MONEY_TOLERANCE；分母为 0 不触发

## 验证
`npm run typecheck && npm run lint && npm test` 全绿 + E2E 三 project（沿用 `_auth.ts` 共享登录态）。

## 明确不做（本期）
- 续签审批流差异（复用现有创建审批）；续签提醒频率调整（30/7/1 到期阈值不动）
- 详情页新 Tab；`contract-linkage.ts` 编排层（spec §6.2 明确排除）
- 开票/回款累计 422 校验（已有，不动）
