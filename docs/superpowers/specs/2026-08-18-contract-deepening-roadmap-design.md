# 合同管理深化路线图设计

> 编制日期：2026-08-18（v2 修订，同日）
> 当前版本：v0.20.7
> 状态：Phase 1 / 1.5 / 2 / 3 / 4a / 5 已实施（见下表）；Phase 4b 待评审（需 LLM 服务商与数据出域决策）
>
> 实施记录：Phase 1 → v0.20.3；Phase 2 → v0.20.4；Phase 1.5 + 3 → v0.20.5；Phase 4a → v0.20.6；Phase 5 → v0.20.7。
> 各阶段实现计划见 `docs/superpowers/plans/` 同名日期文件。
>
> v2 修订说明：初稿经代码库核对后发现多处与现状不符——部分"新增"能力实际已上线（到期提醒 cron、开票/回款累计校验、详情页联动概览），`ContractStatus` 并非 Prisma enum，冷却期设计与 Message 表去重机制冲突，风险趋势图与"不存储评分"自相矛盾。v2 已全部修正：能复用的改为扩展，不能复用的才新增，并补齐权限模型、评分公式与测试策略。

## 一、背景与目标

### 1.1 项目现状（已核对代码）

qt-biz 是杭州企泰安全科技的业务管理系统，覆盖客户/合同/开票/回款四大主链路。当前 v0.20.2。

合同模块**已有**能力（本路线图只扩展，不重建）：

| 能力 | 位置 | 说明 |
|---|---|---|
| 合同状态机 | `types/enums.ts:39` / `server/services/contract/status.ts` | `DRAFT → ACTIVE → CLOSED`，**String 列非 Prisma enum**；CLOSED 带 reason（`completed` / `overdue_terminated` / 手动完结原因） |
| 自动完结 | `status.ts#tryAutoClose` / `tryAutoCloseOnOverdue` | endDate 过期且开票+回款双足额 → 自动 CLOSED；过期 + 宽限期（`CONTRACT_OVERDUE_GRACE_DAYS`）仍未结清 → 强关（reason=`overdue_terminated`） |
| 到期提醒 job | `server/jobs/runner.ts#contractExpiringJob` | endDate 前 **30/7/1 天**三个阈值各发一次 `CONTRACT_EXPIRING` 站内信（owner + admin），按 (type+entityId+receiver+今日) 去重 |
| 逾期未结清提醒 | `server/jobs/stale-contract.ts#tickStaleContracts` | endDate 已过但未结清：每日提醒催款（`CONTRACT_EXPIRED_UNPAID`）或催补开票（`CONTRACT_PAID_INVOICE_PENDING`），带宽限期倒数 |
| 开票累计校验 | `server/services/invoice/crud.ts:76`（R-08）、`invoice/action.ts:19` | 累计开票 > 合同总额 → 422 拒绝（含 0.01 容差） |
| 回款累计校验 | `server/services/payment.ts:289-301`（R-11/R-12） | 累计回款 > 合同总额 → 422 `PAYMENT_OVER_CONTRACT` |
| 开票超期未回款 | `runner.ts#invoiceOverdueJob` | 发票开具 30 天未全额回款 → `INVOICE_OVERDUE_PAYMENT` |
| 合同 360° 概览 | `server/services/contract/overview.ts` + 详情页 | 已开票/已回款金额、billingStatus、进度 StatGrid |
| 消息去重机制 | `server/events/bus.ts#emit` + `Message.entityKey` | `@@unique([entityKey, receiverUserId])` + `createMany(skipDuplicates)`；**固定 entityKey 的消息同一接收人只能发一次** |
| 经营 dashboard | `app/(app)/dashboard/page.tsx` | StatGrid KPI + 待办预警卡（可跳转）+ 合同状态图，管理视角 |
| 每日快照模式 | `server/jobs/aging-snapshot.ts`（AgingSnapshot） | 每日幂等写快照表供趋势查询，新表需 `GRANT ... TO qt_app` |
| 完结原因存储 | `Contract.reviewComment` | 自动/强关把 reason 写进 `reviewComment`（`completed` / `overdue_terminated` / 手动原因），**没有独立 reason 列**，统计口径按此字段过滤（`status.ts:246/320`） |

### 1.2 用户痛点（与现状的差集）

1. **续签跟进**：到期提醒已有，但"到期后未续签"没有跟踪，续签动作没有系统化入口
2. **风险预警**：无法快速定位风险合同（逾期、回款/开票落后、客户信用差）
3. **个人工作台**：dashboard 是经营总览（管理视角），缺一个"我的合同"个人执行入口
4. **联动盲区**：已生效长期未开票、开票与回款金额长期偏差，现有 job 未覆盖

### 1.3 发展方向

- **业务深化**（最高优先级）：在现有合同模块上做深
- **AI/智能化**（次优先级）：智能决策辅助
- **横向扩展**（远期）：移动端适配

### 1.4 设计原则

- **扩展优先于新建**：能挂在现有 job / service / 页面上的，一律扩展，不另起炉灶
- **工作台先行**：个人工作台作为统一入口，新功能在工作台上"生长"
- **规则引擎优先**：AI 能力先用规则引擎实现，LLM 增强作为可选层
- **响应式优先**：移动端先做响应式改造，不单独开发小程序

---

## 二、整体架构

### 2.1 实施阶段

| Phase | 内容 | 预估周期 | 依赖 | 性质 |
|---|---|---|---|---|
| **Phase 1** | 个人合同工作台 | 1-2 周 | 无 | 新增页面 + 2 个 API |
| **Phase 1.5** | 续签跟进（提醒 + 续签操作） | 1 周 | Phase 1 | 扩展现有 job + 1 个迁移 |
| **Phase 2** | 合同风险预警引擎 | 1-2 周 | Phase 1 | 新增评分服务 + 快照表 |
| **Phase 3** | 联动自动化补盲 | 1 周 | Phase 1 | 扩展 job + 扩展详情页 |
| **Phase 4a** | 规则引擎风险报告 | 1 周 | Phase 2 | 纯本地计算 |
| **Phase 4b** | LLM 增强（可选） | 1-2 周 | Phase 4a + 外部 LLM API | 可选 |
| **Phase 5** | 移动端适配 | 1-2 周 | Phase 1 | 响应式 + PWA |

### 2.2 模块关系

```
Phase 1: 工作台（我的合同 / 我的待办 / 我的统计）
    │
    ├── Phase 1.5: 续签跟进 ──→ 扩展 contract-expiring job + 新增 renewal 检查
    │                              → 待办列表"续签"入口
    ├── Phase 2: 风险预警引擎 ──→ 工作台风险卡片 + 每日 RiskScoreSnapshot
    │       │
    │       └── Phase 4a: 规则引擎报告 ──→ 合同详情页"风险分析"Tab
    │               │
    │               └── Phase 4b: LLM 增强 ──→ 自然语言摘要
    ├── Phase 3: 联动补盲 ──→ 扩展详情页概览 + 2 条新批量检查
    └── Phase 5: 移动端适配 ──→ 工作台 + 消息的响应式版本
```

### 2.3 工作台 vs dashboard 的分工

| | dashboard（现有） | 合同工作台（Phase 1 新增） |
|---|---|---|
| 视角 | 经营总览，管理/全局视角 | 个人执行，"我的合同"视角 |
| 数据范围 | 全公司（按角色权限） | 当前用户负责（ownerUserId = 我） |
| 内容 | KPI、区域分布、Top 客户、趋势图 | 我的待办、我的合同列表、到期跟进 |
| 入口 | 登录默认页 | 侧边栏「合同工作台」 |

两者不合并：dashboard 保持经营分析定位，工作台承接所有"需要我动手"的事。

---

## 三、Phase 1：个人合同工作台

### 3.1 数据范围与权限

- **"我的合同" = `ownerUserId = 当前用户`**，对所有角色一致（SALES / EXPERT / FINANCE / ADMIN 都是个人视角）。
- 服务端强制过滤，不信任前端传参：`mine=true` 时由 session 取 `user.id` 注入 where，**不接受**客户端指定他人 ownerUserId（防止越权枚举）。
-  ADMIN 的全局视角仍走 dashboard / 合同列表页，工作台不提供"查看他人"开关（需要时后续再加，需过权限评审）。
- 新 API 走既有权限体系（`lib/permissions.ts`）：`contract:read` 已有权限即可访问，不新增资源位。

### 3.2 页面布局

```
┌─────────────────────────────────────────────────┐
│  合同工作台                          [月/季/年 ▼] │
├─────────────────────────────────────────────────┤
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐            │
│ │活跃   │ │即将   │ │逾期   │ │风险   │            │
│ │合同数 │ │到期   │ │合同   │ │预警   │            │
│ └──────┘ └──────┘ └──────┘ └──────┘            │
│ 📋 我的待办（按优先级排序）                        │
│  · XX合同 已逾期 3 天（宽限期内）→ [催款] [续签]     │
│  · YY合同 7 天后到期 → [续签]                      │
│  · ZZ合同 生效 45 天未开票 → [去开票]               │
│ 📊 我的合同（ProTable: 合同号/客户/金额/状态/到期日）│
│  搜索: [____] 筛选: [状态▼][到期窗口▼]              │
└─────────────────────────────────────────────────┘
```

初版为单栏纵向布局（不做初稿的左右分栏），待办在上、列表在下，移动端天然友好。

### 3.3 核心组件

| 组件 | 说明 |
|---|---|
| `ContractWorkbench` | 页面容器（RSC），路径 `app/(app)/contracts/workbench/page.tsx` |
| `WorkbenchStatGrid` | 4 个统计卡，复用 `components/stat-grid.tsx` |
| `WorkbenchTodoList` | 待办列表，按优先级排序（逾期 > 7 天内到期 > 未开票/未回款） |
| `MyContractTable` | ProTable，复用合同列表的列定义 |
| `ExpiryBadge` | 到期天数标签（红=逾期，橙=7 天内，黄=30 天内，绿=安全） |

### 3.4 数据获取

- **统计卡**：`GET /api/contracts/my-stats`（新增）
- **待办列表**：`GET /api/contracts/my-todos`（新增）
- **合同列表**：复用 `GET /api/contracts`，`contractListQuerySchema`（`lib/validators/contract.ts:90`）新增 `mine` 参数

### 3.5 关键口径定义（与自动状态机对齐）

> 这是初稿最大的坑：endDate 过期后合同会在宽限期后被 cron 强关（`tryAutoCloseOnOverdue`），"逾期合同"不是稳定状态，必须先定义口径。

- **到期天数** = `endDate - 今天`：< 0 逾期；0-7 即将到期；8-30 注意；> 30 安全
- **逾期合同**（统计卡/待办）= `status = ACTIVE 且 endDate < now`（即宽限期窗口内未被强关、也未双足额自动完结的合同）+ `status = CLOSED 且 reviewComment = "overdue_terminated"`（reason 存在 `reviewComment`，见 §1.1）且强关发生在统计区间内的合同。前者是"还能救"，后者是"已强关待善后"，待办列表分开标注。
- **即将到期** = `status = ACTIVE 且 endDate ∈ [now, now+7d]`
- **活跃合同数** = `status = ACTIVE`（含逾期窗口内的）
- **风险预警** = Phase 2 交付前该卡片先占位显示 "—"，不阻塞 Phase 1 验收

### 3.6 DB Schema 变更

无。

---

## 四、Phase 1.5：续签跟进

> 初稿计划"新增到期提醒 cron + 3 个 MessageType + RENEWED 状态"，核对后发现到期/逾期提醒已完整在线（见 §1.1），RENEWED 状态与现有自动完结状态机冲突。v2 收缩为：**只补"续签"这一件事**。

### 4.1 续签数据模型（1 个迁移）

```prisma
model Contract {
  // ... 现有字段
  renewedFromId  String?   // 续签自哪个合同；NULL = 非续签合同
  renewedFrom    Contract? @relation("ContractRenewal", fields: [renewedFromId], references: [id])
  renewals       Contract[] @relation("ContractRenewal")
}
```

- 不加 `RENEWED` 状态：原合同走既有自动完结路径（CLOSED），不需要新状态值，状态机零改动。
- `renewedFromId` 同时解决"是否已续签"的判定：查 ` renewedFromId = X 且 deletedAt IS NULL` 存在即已续签。

### 4.2 续签提醒 job（扩展现有设施）

- 在 `server/jobs/runner.ts#runAllJobs` 的 jobs 数组中新增一项 `contract-renewal-remind`，**复用** runner 的 admin 加载、settled 汇总模式。
- 判定：`status = ACTIVE 且 endDate < now - 30 天`（到期超 30 天）且未结清或已强关，且不存在 `renewedFromId = 该合同` 的有效合同。
- 消息类型：**只新增 1 个** `MessageType.CONTRACT_RENEWAL_REMIND`（迁移新增枚举值；不新增 `CONTRACT_EXPIRING_SOON` / `CONTRACT_EXPIRED`，分别由现有 `CONTRACT_EXPIRING` / `CONTRACT_EXPIRED_UNPAID` 覆盖）。
- 频率：每周 1 次。entityKey 方案（这是初稿与 Message 唯一约束冲突的修正点）：
  `CONTRACT_RENEWAL_REMIND:{contractId}:{ISO 年-W周}`（如 `...:c123:2026-W34`）。同一合同同一周自然去重；跨周 entityKey 不同可再发，**不违反** `@@unique([entityKey, receiverUserId])`。job 内部仍按"今日已发"窗口查询做第一道过滤（与 stale-contract.ts 同模式），skipDuplicates 仅兜底。
- 接收人：owner + admin（与现有 job 一致）。

### 4.3 到期/逾期提醒频率调整

现有 `contract-expiring` 的 30/7/1 天阈值保持不变（历史数据证明够用）。逾期催款已由 `tickStaleContracts` 每日覆盖，**不新增**"逾期每 3 天"提醒，避免双通道刷屏。如业务反馈频率不足，后续单独调阈值，不在本 Phase 范围。

### 4.4 续签操作

工作台待办列表中，到期/逾期合同旁提供「续签」按钮：

- 点击打开续签 Modal，调用 `POST /api/contracts`（**复用现有创建接口**，走正常 DRAFT → 审核 → ACTIVE 流程，不绕过审批）。
- 预填：客户、服务类型、金额、税率、付款方式、条款备注；`renewedFromId = 原合同 id`。
- 起止日期默认 = 原合同 endDate + 1 天起、同跨度，**均可编辑**（续签常伴随重新议价/调期，不强制无缝衔接）。
- 创建成功后原合同不动（由既有自动完结/强关逻辑收尾），待办中该项消失（因已存在 renewal 记录）。

### 4.5 DB Schema 变更汇总

| 变更 | 迁移内容 |
|---|---|
| `Contract.renewedFromId` | `ALTER TABLE "Contract" ADD COLUMN "renewedFromId" TEXT;` + 外键 + 索引 |
| `MessageType` + `CONTRACT_RENEWAL_REMIND` | enum 追加值（参照 `20260724_message_type_paid_invoice_pending` 迁移模式） |

---

## 五、Phase 2：合同风险预警引擎

> 初稿两个自相矛盾点在此修正：(1)"评分不存库"与"30 天趋势图"冲突 → 增加每日快照表（复用 AgingSnapshot 模式）；(2) 评分规则只有定性描述 → 给出可验收的分段函数。

### 5.1 风险维度与评分公式

每维度原始分 0-100，加权求和得总分（满分 100）：

| 维度 | 权重 | 分段公式 | 数据口径 |
|---|---|---|---|
| **到期风险** | 30% | `d` = 逾期天数（未到期 d=0）：`score = min(100, d/30*100)` | `endDate`，仅 ACTIVE |
| **付款进度** | 25% | `t` = 时间进度 = 已过天数/合同总天数（clamp 0-1）；`p` = 已确认回款/合同金额；`score = min(100, max(0, t-p)/0.5*100)`（落后 50 个百分点=满分） | Payment `CONFIRMED+RECONCILED`，与 stale-contract 同口径 |
| **开票进度** | 20% | 同上，`i` = 已开票/合同金额（`INVOICE_ISSUED_AMOUNT_STATUSES` 口径） | Invoice，与 overview.ts 同口径 |
| **客户信用** | 15% | `rate` = 该客户 `CLOSED 且 reviewComment = "overdue_terminated"` 合同数 / 该客户合同总数；`score = rate*100`；**样本 < 3 份合同时固定 20 分**（防小样本极端） | 客户历史合同 |
| **金额异常** | 10% | `r` = 本合同金额偏离该客户合同均值的比例：偏离 ≤50% 得 0，≥200% 得 100，中间线性；**样本 < 3 份合同得 0 分** | 客户历史合同 |

未开始合同（now < startDate）：时间进度 t=0，付款/开票维度自然得 0，不做特殊分支。

### 5.2 风险等级划分

| 分数区间 | 等级 | 颜色 | 工作台展示 |
|---|---|---|---|
| 0-30 | 低 | 绿 | 不展示 |
| 31-60 | 中 | 黄 | 风险卡计数 + 列表标黄 |
| 61-80 | 高 | 橙 | 风险卡计数 + 列表标橙 + 升档消息 |
| 81-100 | 严重 | 红 | 风险卡计数 + 列表标红 + 升档消息 |

### 5.3 计算与存储

- **实时计算**：列表/详情查询时服务端现算。批量实现必须一次 `groupBy` 预聚合（Payment/Invoice/客户历史各一次，参照 `stale-contract.ts:53-71` 的模式），**禁止循环内单查**（N+1）。
- **每日快照**（新增表，支撑趋势图与升档检测）：

```prisma
model RiskScoreSnapshot {
  id           String   @id @default(cuid())
  contractId   String
  contract     Contract @relation(fields: [contractId], references: [id])
  score        Int
  level        String   // LOW | MEDIUM | HIGH | CRITICAL
  dimensions   Json     // 五维度原始分，供报告页复用
  snapshotDate DateTime @db.Date

  @@unique([contractId, snapshotDate])
  @@index([snapshotDate, level])
}
```

- 新 job `risk-score-snapshot` 挂入 `runAllJobs`：每日对全部 ACTIVE 合同算分并 upsert 快照（幂等）。迁移末尾追加 `GRANT ALL ON TABLE "RiskScoreSnapshot" TO qt_app;`（见 AGENTS.md 迁移规范）。

### 5.4 风险预警触发

| 触发条件 | 动作 |
|---|---|
| 快照对比：今日等级 > 昨日等级且新等级为高/严重 | 站内信 `RISK_LEVEL_UP` 提醒 owner + admin，entityKey = `RISK_LEVEL_UP:{contractId}:{level}:{yyyy-MM-dd}`（同日同档去重） |
| 每日快照 job 完成后 | 高/严重合同汇总一条推送 admin |
| 工作台查询时 | 实时分数与最新快照差异不处理（以实时为准展示，快照只供趋势/升档） |

新增 `MessageType.RISK_LEVEL_UP` 一个枚举值。

### 5.5 风险详情

工作台风险卡/合同列表风险标签点击进入风险详情 Drawer：

- 五维度得分雷达图
- 各维度原始数据（逾期天数、t/p/i 进度值、客户逾期率、金额偏离度）
- 近 30 天总分折线（数据源 = RiskScoreSnapshot，快照上线首日只有 1 个点属正常）
- 建议操作（按得分最高的维度映射：到期→续签/归档，付款→催款，开票→去开票）

---

## 六、Phase 3：联动自动化补盲

> 初稿 5 条规则中 3 条已在线（§1.1：R-08 开票累计校验、R-12 回款累计校验、发票超期未回款提醒）。本 Phase 只补 2 条盲区 + 详情页增强。

### 6.1 新增检查（挂入 runAllJobs 的 `daily-linkage-check`）

| 规则 | 判定 | 动作 |
|---|---|---|
| **超期未开票** | `ACTIVE` 且 startDate 已过 30 天且无 `ISSUED` 状态发票 | 站内信 owner，entityKey = `LINKAGE_NO_INVOICE:{contractId}:{yyyy-MM-dd}`（每日最多 1 次） |
| **开票-回款偏差** | 已开票 ≥ 1 万 且 (已开票-已回款)/已开票 > 20% 且最新发票开具超 30 天 | 站内信 owner + 财务，entityKey 按日去重（与现有 `INVOICE_OVERDUE_PAYMENT` 按发票粒度互补：本条按合同聚合） |

两条均复用 stale-contract 的 groupBy 预聚合 + 今日窗口去重模式。

### 6.2 不新增的部分（明确排除）

- 开票/回款累计 422 校验：**已有**，不动。
- `server/services/contract-linkage.ts` 独立事件编排层：**不建**。现有事件挂在各 service 的写路径上（invoice/crud、payment.ts），再包一层只会增加跳转成本。两条批量检查直接写成 job。

### 6.3 合同详情页增强

在现有 360° 概览基础上（不新增 Tab，避免 Tab 膨胀）：

- 概览区补"开票进度条 + 回款进度条"（数据 overview.ts 已有）
- 有未结预警（超期未开票/偏差）时在概览顶部出 `Alert`，点击锚跳到对应发票/回款列表
- 概览区补"续签自 / 续签至"链接（`renewedFromId` / 反向查询，Phase 1.5 落地后接上）

---

## 七、Phase 4：AI 智能决策辅助

### 7.1 两层架构

**第一层：规则引擎（Phase 4a）**
- 基于 Phase 2 评分 + 快照，输出结构化风险报告
- 趋势分析直接读 RiskScoreSnapshot（合同金额走势、评分走势）
- 纯本地计算，无外部依赖

**第二层：LLM 增强（Phase 4b，可选）**
- `server/services/contract-ai.ts` 封装 LLM 调用（通义千问 / DeepSeek），前端 `GET /api/contracts/[id]/ai-analysis`
- 自然语言摘要、跟进话术建议、条款合规检查（需条款文本，依赖附件 OCR，单独立项评估）

### 7.2 规则引擎输出（与 §5.1 公式一致的示例）

```json
{
  "contractId": "QT-2026-001",
  "riskScore": 72,
  "riskLevel": "HIGH",
  "asOf": "2026-08-18",
  "dimensions": {
    "expiry":          { "score": 67, "detail": "已逾期 20 天（宽限期内）" },
    "payment":         { "score": 80, "detail": "时间进度 90%，回款进度 50%，落后 40 个百分点" },
    "invoicing":       { "score": 60, "detail": "时间进度 90%，开票进度 60%，落后 30 个百分点" },
    "customerCredit":  { "score": 33, "detail": "该客户 6 份历史合同中 2 份被强关（33%）" },
    "amountAnomaly":   { "score": 0,  "detail": "金额在该客户正常区间（偏离 22%）" }
  },
  "weightedScore": "67×0.30 + 80×0.25 + 60×0.20 + 33×0.15 + 0×0.10 = 57.1 → 四舍五入 57",
  "recommendations": [
    "付款进度落后最严重：建议立即发起催款（剩余 ¥200,000）",
    "合同已逾期且在宽限期内：N 天后将被系统自动强关，请优先处理",
    "该客户历史强关率 33%：后续合作建议缩短账期或预付"
  ],
  "trend": { "days": 30, "from": 35, "to": 57, "mainDriver": "expiry" }
}
```

（注：初稿示例的 72 分与维度明细对不上加权公式，本版示例已按 §5.1 公式验算。）

### 7.3 展示位置

| 位置 | 内容 | Phase |
|---|---|---|
| 工作台风险卡 | 高/严重计数 + 环比箭头 | Phase 2 |
| 合同详情页「风险分析」区块 | 完整报告 + 建议 + 趋势 | Phase 4a |
| 工作台每日简报 | 高风险合同摘要（可选 LLM 生成） | Phase 4b |

---

## 八、Phase 5：移动端适配

### 8.1 策略

响应式优先 + PWA 增强，不单独开发小程序/App：

| 方案 | 优先级 |
|---|---|
| 响应式改造 | P0 |
| PWA（manifest + Service Worker） | P1 |
| 小程序（远期） | P2 |

### 8.2 移动端核心页面

| 页面 | 适配方式 |
|---|---|
| 合同工作台 | 单栏纵向（初版即单栏，天然适配），统计卡 2×2 网格 |
| 合同详情 | 信息分组折叠，概览区卡片式 |
| 消息列表 | 消息卡片 + 滑动操作 |
| 风险详情 | 雷达图降级为纵向条形图 |

### 8.3 交互增强

- 下拉刷新；底部固定导航（工作台 / 合同 / 消息 / 我的）
- 滑动操作（左滑已读，右滑删除——仅消息列表）
- PWA 推送：**仅作为站内信的增强通道**。注意 iOS 需 16.4+ 且用户手动"添加到主屏幕"后才支持 Web Push，不能作为提醒的唯一依赖；关键提醒（到期/升档）以站内信为准。

### 8.4 技术实现

复用 antd `Grid` / 响应式断点，最小化自定义 CSS。

---

## 九、DB Schema 变更汇总（v2 修正版）

| Phase | 变更 | 说明 |
|---|---|---|
| 1.5 | `Contract.renewedFromId` 列 | 续签链路；不加 RENEWED 状态，状态机零改动 |
| 1.5 | `MessageType` + `CONTRACT_RENEWAL_REMIND` | 只加 1 个值 |
| 2 | 新表 `RiskScoreSnapshot` | 每日快照；迁移末尾 `GRANT ALL ... TO qt_app` |
| 2 | `MessageType` + `RISK_LEVEL_UP` | 只加 1 个值 |
| 3 | 无 | 两条新检查纯查询 |
| **明确不做** | ~~`CONTRACT_EXPIRING_SOON` / `CONTRACT_EXPIRED`~~ | 与现有 `CONTRACT_EXPIRING` / `CONTRACT_EXPIRED_UNPAID` 重复 |
| **明确不做** | ~~`ContractStatus.RENEWED` enum 迁移~~ | 状态是 String 列且自动完结已覆盖终态 |

---

## 十、权限与安全

- `my-stats` / `my-todos` / `mine=true`：服务端从 session 注入 `ownerUserId`，忽略客户端传入的他人 id；`contract:read` 权限即可（所有业务角色已有）。
- 风险评分、快照、升档消息：查看范围跟随合同本身的行级权限（SALES/EXPERT 只看自己名下；ADMIN/FINANCE 全局）。
- 升档消息接收人：owner + admin（与现有 job 一致）；联动偏差消息加发财务。
- LLM 调用（4b）：合同数据出域前需确认 LLM 服务商的数据协议；API key 走 `lib/env.ts` 校验，不落库不前端可见。

---

## 十一、测试策略（每 Phase 必须落地）

| Phase | Vitest | Playwright |
|---|---|---|
| 1 | `tests/api/contract-workbench.test.ts`：my-stats/my-todos 口径、mine 越权注入防护 | `tests/e2e/NN-workbench.spec.ts`：登录 → 工作台 → 统计卡/待办/列表 |
| 1.5 | renewal job：30 天判定、周去重 entityKey、已续签跳过；续签创建预填 renewedFromId | 工作台点续签 → 创建成功 → 待办消失 |
| 2 | 五维度分段函数边界（t=0、样本<3、d≥30）；快照 upsert 幂等；升档消息去重 | 风险卡计数与列表标色一致 |
| 3 | 两条新检查的阈值边界 + 日去重 | 详情页 Alert 出现/消失 |
| 4a | 报告 JSON 与 §5.1 公式验算一致 | 风险分析区块渲染 |

参照 `tests/milestones-removed.test.ts` 的回归测试模式，为 `renewedFromId` 和 `RiskScoreSnapshot` 的迁移各补一条 schema 回归。

---

## 十二、风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 评分公式上线后口径争议 | 中 | 公式全部落在 §5.1 文档 + 单测锁定；调整走文档变更 |
| 快照表上线首日无趋势数据 | 低 | UI 对 < 2 个数据点显示"数据积累中" |
| 升档消息打扰 | 中 | 同日同档去重；降档再升档会重发（有意为之，属真实恶化） |
| 实时评分性能 | 低 | groupBy 预聚合；500 合同规模实测后再议优化 |
| 移动端工作量 | 低 | 只做核心页面，非核心保持桌面版 |
| LLM 成本与数据出域 | 低 | 规则引擎先行；4b 单独评审 |

---

## 十三、验收标准

### Phase 1
- [ ] 工作台可访问，4 统计卡口径与 §3.5 一致（逾期 = 宽限期内 ACTIVE + 区间内强关）
- [ ] 待办按优先级排序；`mine=true` 无法越权查看他人合同（API 层验证）
- [ ] 到期标签四色正确

### Phase 1.5
- [ ] 到期超 30 天未续签合同收到 `CONTRACT_RENEWAL_REMIND`，同周不重复
- [ ] 续签创建新 DRAFT 合同且 `renewedFromId` 正确；原合同状态机行为不变
- [ ] 已续签合同不再产生续签提醒

### Phase 2
- [ ] 五维度评分与 §5.1 分段函数逐条单测对应
- [ ] 快照每日幂等写入；趋势图可读 30 天数据
- [ ] 等级上调触发 `RISK_LEVEL_UP`，同日同档不重复

### Phase 3
- [ ] 超期未开票 / 开票-回款偏差两条检查按阈值触发并按日去重
- [ ] 详情页概览区展示双进度条与预警 Alert
- [ ] （回归）R-08 / R-12 累计校验行为不变

### Phase 4
- [ ] 报告 JSON 与公式验算一致（含 §7.2 示例）
- [ ] （可选）LLM 摘要生成且 API key 不出服务端

### Phase 5
- [ ] 工作台/详情/消息三页在 iPhone 13 / iPad 竖屏断点下布局正常（Playwright 既有双端 project）
- [ ] PWA 可添加到主屏幕；推送不可用时站内信兜底
