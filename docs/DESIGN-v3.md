# 杭州企泰安全科技有限公司 业务管理系统 — 完整设计文档（v3，最新版本矩阵审查版）

## 0. 修订说明（相对 v2）

- **版本矩阵钉到当前 latest**，所有包名与具体版本号写入方案。
- **antd 6 + pro-components 3.x beta** 的破坏性变更与 SSR 注意事项显式列出，避免实现期踩坑。
- **Next 16 + React 19** 下的 Server Action / Route Handler / Cookie / fetch 默认值差异点补充。
- **Prisma 7** 新增的 ESM-only、`prisma-client` generator、ESM 导入方式变化补充。
- **Zod 4** 语法变化点补充。
- **next-auth v4** 在 Next 16 + RSC 下的边界场景补充（v4 与 RSC 协作需要 `auth()` 包装，详见 §8）。

---

## 1. 技术栈与版本矩阵（钉版本）

> 所有版本基于 npm registry `latest` 标签核实（截至 2026-06）。

| 层 | 包 | 版本 | 备注 |
|---|---|---|---|
| 框架 | `next` | **16.2.7** | App Router；RSC + Server Actions；React 19 |
| 语言 | `typescript` | **6.0.3** | `strict: true`、`noUncheckedIndexedAccess: true` |
| 运行时 | `react` / `react-dom` | **19.2.7** | 与 Next 16 配套 |
| 数据库 | PostgreSQL | **16.x** | `pgcrypto`、RLS、`generate_series`、窗口函数 |
| ORM | `prisma` / `@prisma/client` | **7.8.0** | Prisma 7 默认 ESM；使用新的 `prisma-client` generator（输出到 `node_modules/.prisma/client`） |
| 校验 | `zod` | **4.4.3** | 用 `z.object(...).meta(...)`；错误用 `z.treeifyError` |
| 认证 | `next-auth` | **4.24.14** | `latest` 仍为 v4；JWT 策略 + Credentials Provider |
| 适配器 | `@auth/prisma-adapter` | **2.11.2** | – |
| UI 库 | `antd` | **6.4.3** | `latest`；React 19 OK；`@ant-design/cssinjs@2.1.2` 内置 |
| 中后台 | `@ant-design/pro-components` | **3.1.12-0（beta）** | antd 6 配套；锁定此 beta 直至官方 `latest` |
| 样式 SSR | `@ant-design/nextjs-registry` | **1.3.0** | RSC 下注入 antd cssinjs 样式 |
| 图标 | `@ant-design/icons` | **6.2.5** | – |
| 图表 | `@ant-design/charts` | **2.6.7** | ProCard 看板 |
| 工具 | `dayjs` | **1.11.21** | Ant 默认时间库 |
| 状态 | `zustand` | **5.0.14** | 客户端轻量状态 |
| 数据请求 | `swr` | **2.4.1** | RSC 之外的客户端数据获取 |
| 导入导出 | `exceljs` | **4.4.0** | xlsx 流式生成 |
| 邮件 | `nodemailer` | **8.0.10** | P3 邮件通道（默认关闭） |
| 加密 | `bcrypt` | **6.0.0** | 密码哈希 |
| 国际化 | `next-intl` | **4.13.0** | zh-CN；预留 en-US |
| 环境变量 | `@t3-oss/env-nextjs` | **0.13.11** | 强类型 env |
| Prisma→Zod | `zod-prisma-types` | **3.3.11** | 生成器（可选；评审通过后用） |
| 测试 | `vitest` | **4.1.8** | 单测 + 集成 |
| E2E | `@playwright/test` | **1.60.0** | – |
| 包管理 | `pnpm` | – | workspace 预留 |

> **实现期必做的版本约束**：在 `package.json` 用 `pnpm.overrides` 锁住 `rc-util`、`@ant-design/cssinjs`、`@ant-design/icons` 三个 antd 子依赖的版本，避免 transitive 升级破坏 antd 6 + pro 3 的兼容性。

---

## 2. antd 6 + pro-components 3.x beta 关键差异（实现前必读）

> 这些点必须在 P0 脚手架里落地，否则后续所有页面踩坑。

1. **样式 SSR 必须用 `@ant-design/nextjs-registry`**
   - `app/layout.tsx` 顶层包 `<AntdRegistry>{children}</AntdRegistry>`，否则 RSC 下首屏闪烁。
2. **ConfigProvider 主题 token 结构变化**
   - antd 6 引入 `cssVar: true` 模式（推荐启用，配合 `@ant-design/cssinjs` v2 的 CSS 变量）；`token` API 兼容 5.x，但部分算法名变化（`theme.darkAlgorithm` → `theme.darkColorWeakAlgorithm`，旧名仍兼容但会有 deprecation warning）。
   - 推荐：`theme={{ cssVar: true, hashed: false, token: { colorPrimary: '#1677ff', borderRadius: 6 } }}`。
3. **pro-components 3.x 内部 API 调整**
   - `ProTable` 的 `request` 入参 `{ current, pageSize, ...filters, sorter }`（与 2.x 一致）；但 `valueType` 新增 `'digitRange'`、`'dateWeek'`；旧的 `'money'` 仍可用，但金额列建议直接 `'digit'` + `render` 自行格式化。
   - `ProForm` 在 antd 6 + React 19 下要求 `formProps={{ layout: 'vertical' | 'horizontal' | 'inline' }}` 显式指定；不再从外层 ConfigProvider 全局推断。
4. **React 19 兼容性**
   - antd 6 已支持 `ref` 作为普通 prop（不再需要 `forwardRef`），pro 3 已适配；老自定义组件需去除 `forwardRef`。
   - `useForm` 的 `form` 实例在 RSC 中**不可**直接传递；表单组件必须 `'use client'`。
5. **SSR + 国际化**
   - `ConfigProvider` 必须包裹在 `<AntdRegistry>` 内、外层 `NextIntlClientProvider` 内（如果启用 i18n），顺序：`AntdRegistry > ConfigProvider(locale=zhCN) > NextIntlClientProvider > ProLayout`。
6. **next-auth v4 + Next 16 边界**
   - v4 仍是 `latest`，peer 支持 `next: ^12.2.5 || ^13 || ^14 || ^15 || ^16`；可正常工作。
   - v4 的 `getServerSession()` 在 RSC 中可用，但需用 `authOptions` 显式传入；与 v5 的 `auth()` 写法不同。
   - 强烈建议**会话信息**通过 `getServerSession` 读，**登录登出**走 Route Handler；`useSession` 仅在 Client 组件顶部使用。
7. **Prisma 7 注意事项**
   - Prisma 7 默认 ESM only，`@prisma/client` 改为 `import { PrismaClient } from '@prisma/client'`（CJS 需 `import('@prisma/client')` 动态导入；Node 24 OK）。
   - 使用 `output` 字段把生成的 client 放到 `node_modules/.prisma/client`（默认），构建时无需 `prisma generate`（postinstall 自动）。
   - `$transaction` 隔离级别枚举：`Prisma.TransactionIsolationLevel.Serializable` 仍存在。
8. **Zod 4 语法变化**
   - `z.string().email()` 仍兼容；`z.string().datetime()` 在 4.x 中拆分到 `z.iso.datetime()`。
   - `safeParse` 行为不变；`z.treeifyError(err)` 替代 3.x 的 `errorMap` 树状格式化。
   - 推断类型：`type X = z.infer<typeof schema>` 不变。

---

## 3. 系统角色与权限矩阵

### 3.1 4 个内置角色

| 角色 | `code` | 主要职责 |
|---|---|---|
| 管理员 | `ADMIN` | 全部模块读写 + 用户/角色/字典/审计 |
| 业务人员 | `SALES` | 客户/合同/项目推进；只看自己负责的数据 |
| 财务人员 | `FINANCE` | 开票/回款/对账/统计全权；客户/合同只读 |
| 行政人员 | `OPS` | 客户/合同/项目基础信息维护（不触碰金额字段） |

### 3.2 资源 × 操作 × 角色 矩阵

资源：`USER` `ROLE` `DICTIONARY` `CUSTOMER` `CONTRACT` `PROJECT` `INVOICE` `PAYMENT` `STATISTICS` `MESSAGE` `ANNOUNCEMENT` `OPERATION_LOG`

操作：`READ` `CREATE` `UPDATE` `DELETE` `EXPORT` `AUDIT`

| 资源 \\ 角色 | ADMIN | SALES | FINANCE | OPS |
|---|---|---|---|---|
| USER | CRUD | R | R | R |
| ROLE | CRUD | – | – | – |
| DICTIONARY | CRUD | R | R | R |
| CUSTOMER | CRUD | CRU(自己) / R(全部) | R | CRU(非金额) |
| CONTRACT | CRUD | CRU(自己) | R | R |
| PROJECT | CRUD | CRU(自己) | R | CRU(非金额) |
| INVOICE | CRUD | C / R(自己合同) | CRUD | R |
| PAYMENT | CRUD | C / R(自己合同) | CRUD | R |
| STATISTICS | R+EXPORT | R(本人业绩) | R+EXPORT | R(无金额) |
| MESSAGE | CRU(自己) | CRU(自己) | CRU(自己) | CRU(自己) |
| ANNOUNCEMENT | CRUD | R | R | CRUD |
| OPERATION_LOG | R | – | – | – |

> **行级隔离**：SALES 角色在 Service 层注入 `ownerUserId = session.userId`；越权访问返回 404。**PG 层 RLS 兜底**（SALES 表上加策略 `USING (current_setting('app.user_id', true) = owner_user_id::text)`，应用层事务开始前 `SET LOCAL app.user_id = ${session.userId}`）。

---

## 4. 业务对象核心模型

### 4.1 实体关系

```
Customer (1) ──< (N) Contract (1) ──< (N) Project (1) ──< (N) Invoice (1) ──< (N) Payment
   │                  │                  │                  │                  │
   ├─< ContactPerson   ├─< Attachment     ├─< ProgressLog    ├─< InvoiceItem    ├─< PaymentAllocation(N)
   ├─< FollowUp        └─< ReviewLog      └─< Milestone(JSON)└─< AuditLog       ↘ ↗
   └─< OperationLog
```

### 4.2 Prisma Schema 关键表（节选，按版本钉到 Prisma 7 语法）

> 通用字段：`id String @id @default(cuid())`、`createdAt DateTime @default(now()) @db.Timestamptz(6)`、`updatedAt DateTime @updatedAt @db.Timestamptz(6)`、`createdById String`、`updatedById String`、`deletedAt DateTime? @db.Timestamptz(6)`（软删）。
> 金额：`@db.Decimal(18,2)`；时间：`@db.Timestamptz(6)`；枚举：Prisma `enum`。

```prisma
enum UserStatus { ACTIVE DISABLED }
enum CustomerType { ENTERPRISE GOV OTHER }
enum CustomerScale { LARGE MEDIUM SMALL MICRO }
enum CustomerLevel { A B C D }
enum CustomerStatus { LEAD NEGOTIATING SIGNED LOST FROZEN }
enum FollowMethod { VISIT CALL WECHAT EMAIL OTHER }
enum FollowResult { INTENT NO_INTENT PENDING SIGNED }
enum ServiceType { SAFETY_CONSULT SAFETY_TRAIN HAZARD_ANA EMERGENCY_PLAN EVALUATION OTHER }
enum ContractStatus { DRAFT ACTIVE CLOSED }
enum PaymentMethod { LUMP_SUM BY_PHASE BY_MONTH BY_QUARTER }
enum ReviewAction { SUBMIT APPROVE REJECT WITHDRAW }
enum ProjectStatus { PLANNED IN_PROGRESS SUSPENDED DELIVERED ACCEPTED CLOSED CANCELLED }
enum InvoiceType { VAT_SPECIAL VAT_GENERAL VAT_ELECTRONIC ELEC_NORMAL }
enum TitleType { COMPANY PERSONAL }
enum InvoiceStatus { DRAFT PENDING_FINANCE ISSUED REJECTED VOIDED RED_FLUSHED }
enum PaymentReceiveMethod { BANK_TRANSFER CHECK CASH WECHAT ALIPAY OTHER }
enum PaymentStatus { PLANNED CONFIRMED RECONCILED REFUNDED CANCELLED }
enum MessageType { CONTRACT_PENDING_REVIEW CONTRACT_EXPIRING INVOICE_OVERDUE_PAYMENT PAYMENT_RECEIVED PROJECT_DUE CUSTOMER_INACTIVE }
```

#### 4.2.1 `User`
- `employeeNo String @unique`、`name`、`email String @unique`、`phone`、`passwordHash String`、`roleId String @relation(...)`
- `department String?`、`status UserStatus @default(ACTIVE)`、`lastLoginAt DateTime?`、`wechatWorkId String?`
- 索引：`@@index([roleId])`、`@@index([status])`

#### 4.2.2 `Role`
- `code String @unique`、`name`、`description String?`
- `permissions Json`(`{ resource, actions[] }[]`)、`isSystem Boolean @default(false)`

#### 4.2.3 `Customer`
- `code String @unique`（自动 `QT-C-YYYYMM-####`）、`name`、`shortName String?`
- `unifiedSocialCreditCode String? @unique`（18 位 GB 32100-2015）
- `customerType CustomerType`、`industry String?`、`scale CustomerScale?`
- `province`、`city`、`address String?`、`contactPhone`、`contactEmail String?`、`sourceChannel String?`
- `level CustomerLevel @default(C)`
- `ownerUserId String`（→ User；SALES 创建=自己，OPS 创建=管理员指定）
- `status CustomerStatus @default(LEAD)`
- `creditLimitAmount Decimal? @db.Decimal(18,2)`、`paymentTermDays Int @default(30)`
- 索引：`@@index([ownerUserId])`、`@@index([status])`、`@@index([level])`

#### 4.2.4 `ContactPerson` / `FollowUp`（同 v2）

#### 4.2.5 `Contract`
- `contractNo String @unique`（`QT-HT-YYYY-####`）
- `customerId`、`customerName String`（快照）
- `title`、`serviceType ServiceType`
- `signDate DateTime`、`startDate DateTime`、`endDate DateTime`
- `totalAmount Decimal @db.Decimal(18,2)`、`taxRate Decimal @default(0.06) @db.Decimal(6,4)`、`taxAmount Decimal @db.Decimal(18,2)`、`amountExcludingTax Decimal @db.Decimal(18,2)`
- `paymentMethod PaymentMethod`、`installmentPlan Json?`
- `status ContractStatus @default(DRAFT)`
- `ownerUserId String`、`reviewerId String?`、`reviewAt DateTime?`、`reviewComment String?`
- `attachments Json`（`{id,name,url,mimeType,size,uploadedBy,uploadedAt}[]`）

- `completionInvoiceRatio Decimal @default(0.95) @db.Decimal(4,2)`
- 索引：`@@index([customerId])`、`@@index([status])`、`@@index([ownerUserId])`

> **交付物附件**（2026-06 调整）：合同详情"交付物"tab 内直接上传实际交付文件（报告/证书/培训材料 等）作为交付物，不再使用结构化 JSON 清单。复用 `Attachment` 表 + MinIO，加 `isDeliverable Boolean @default(false)` 标记"合同交付物附件"（区别于通用"附件"tab）。上传/删除写权限仅对 **admin / 合同签订人 / 合同负责人** 开放（`server/storage/presign.ts: assertCanManageDeliverables`）。

#### 4.2.6 `ContractReviewLog`
- `contractId`、`reviewerId`、`action ReviewAction`、`comment String?`、`at DateTime @default(now()) @db.Timestamptz(6)`

#### 4.2.7 `Project`
- `projectNo String @unique`（`QT-P-YYYY-####`）
- `contractId`、`name`、`serviceScope String`、`managerUserId`
- `startDate DateTime`、`endDate DateTime`、`budgetAmount Decimal? @db.Decimal(18,2)`、`milestones Json?`
- `status ProjectStatus @default(PLANNED)`
- 唯一：`@@unique([contractId, name])`（仅未软删）

#### 4.2.8 `ProjectProgressLog` / `OperationLog` / `Dictionary` / `Sequence`（同 v2）
- `Sequence` 用于业务编号：唯一 `(prefix, year)`，事务内 `SELECT … FOR UPDATE` 保证并发安全。

#### 4.2.9 `Invoice`
- `invoiceNo String @unique`、`invoiceCode String?`
- `projectId`、`contractId String`（快照）、`customerId String`（快照）、`customerName String`（快照）
- `invoiceType InvoiceType`
- `amount Decimal @db.Decimal(18,2)`、`taxRate Decimal @db.Decimal(6,4)`、`taxAmount Decimal @db.Decimal(18,2)`、`amountExcludingTax Decimal @db.Decimal(18,2)`
- `applyDate DateTime`、`expectedIssueDate DateTime?`、`actualIssueDate DateTime?`
- `titleType TitleType`、`titleName`、`taxNo String?`、`bankName String?`、`bankAccount String?`、`address String?`、`phone String?`
- `remark String?`、`attachments Json?`
- `status InvoiceStatus @default(DRAFT)`
- `applicantUserId`、`financeUserId String?`、`reviewedAt DateTime?`、`reviewComment String?`
- `linkedInvoiceId String? @unique`（红冲指向蓝字）
- 索引：`@@index([projectId])`、`@@index([status])`、`@@index([actualIssueDate])`

#### 4.2.10 `InvoiceAuditLog`
- `invoiceId`、`actorId`、`action String`、`before Json?`、`after Json?`、`at DateTime @default(now())`、`comment String?`

#### 4.2.11 `Payment`
- `paymentNo String @unique`（`QT-PAY-YYYY-####`）
- `customerId`、`contractId`、`invoiceId String?`（可空，支持合同预收款）
- `amount Decimal @db.Decimal(18,2)`（正=收款，负=退款）
- `receivedAt DateTime`、`method PaymentReceiveMethod`
- `bankRefNo String? @unique`（`CONFIRMED` 时必填）
- `bankName String?`、`remark String?`
- `status PaymentStatus @default(PLANNED)`
- `recorderUserId`、`reconcileUserId String?`、`reconciledAt DateTime?`
- 索引：`@@index([invoiceId])`、`@@index([contractId])`、`@@index([status])`、`@@index([receivedAt])`

#### 4.2.12 `PaymentAllocation`
- `paymentId`、`invoiceId String?`、`projectId String?`、`amount Decimal @db.Decimal(18,2)`、`remark String?`
- 校验：`SUM(PaymentAllocation.amount) = Payment.amount`（已 CONFIRMED 的收款）

#### 4.2.13 `Message` / `Announcement` / `OperationLog`（同 v2）

> **Prisma 7 generator 设定**：
> ```prisma
> generator client {
>   provider = "prisma-client"
>   output   = "../node_modules/.prisma/client"
>   moduleFormat = "esm"
> }
> ```

---

## 5. 状态机

### 5.1 `Contract.status`（v3 简化版：3 个值 + 自动化）
```
DRAFT ──[auto: 字段完整 + 至少 1 附件]──▶ ACTIVE ──[auto: 开票足额]──▶ CLOSED
   │                                       │                          ▲
   │ admin 强制发布                         │ admin 强制完结            │
   ▼                                       │                          │
[ACTIVE]                                    │ ──[auto: endDate<now]────┘
                                            │     reason=expired
                                            │
                                       reason 区分:
                                       completed / terminated / expired
```
- **→ ACTIVE（auto）**：保存/编辑时若 `signDate/startDate/endDate/totalAmount/taxRate/ownerUserId/signerId` 完整且 `attachments.length ≥ 1`，自动从 DRAFT 升 ACTIVE；`isPublishable(c)` 集中判定。
- **→ CLOSED（auto complete）**：`SUM(Invoice.amount where status=ISSUED) ≥ totalAmount × completionInvoiceRatio`（默认 ratio=0.95，env `CONTRACT_COMPLETION_INVOICE_RATIO` 可调），`tryAutoComplete` 每晚扫一次。
- **→ CLOSED（auto expire）**：`endDate < now()`，daily cron `runContractExpiryJob` 推 CLOSED 并写 `reviewComment="expired"`。
- **admin 兜底入口**：`POST /api/contracts/[id]/publish`（DRAFT→ACTIVE）、`POST /api/contracts/[id]/close`（ACTIVE→CLOSED, body `{reason: "completed"|"terminated"|"expired"}`）。
- **时间线**：所有自动/手动迁移写 `ContractReviewLog.action`（AUTO_PUBLISH / AUTO_CLOSE_COMPLETED / AUTO_CLOSE_EXPIRED / MANUAL_PUBLISH / MANUAL_CLOSE），详情页时间线可见。

### 5.2 `Project.status`
```
PLANNED ─start─▶ IN_PROGRESS ─suspend─▶ SUSPENDED ─resume─▶ IN_PROGRESS
                   │                       │
                   │ deliver               │ cancel
                   ▼                       ▼
                DELIVERED ─accept─▶ ACCEPTED ─auto(合同结清)─▶ CLOSED
                   │                       ▲
                   └──customer reject──────┘ (回 IN_PROGRESS, 记录 rejectReason)
```

### 5.3 `Invoice.status`
```
DRAFT ─submit─▶ PENDING_FINANCE ─issue(finance)─▶ ISSUED ─redFlush(finance)─▶ RED_FLUSHED
                  │                              │
                  │ reject                       │ void(finance, 当日)
                  ▼                              ▼
                REJECTED                       VOIDED
```
- `issue` 触发：自动创建 `Payment{ status: PLANNED, amount: invoice.amount, invoiceId: ... }`。
- `redFlush`：生成负数 `Invoice`，原记录置 `RED_FLUSHED`，`linkedInvoiceId` 互指；同时取消原 PLANNED Payment。

### 5.4 `Payment.status`
```
PLANNED ─confirm(finance)─▶ CONFIRMED ─reconcile(finance)─▶ RECONCILED
   │                          │                                (终态, 不可改)
   │                          └──refund(finance)──▶ REFUNDED(终态)
   └──cancel(创建人, PLANNED 态)──▶ CANCELLED
```

---

## 6. 跨模块校验规则（核心规则清单）

所有规则集中在 `src/server/domain/<entity>/rules.ts`，由 Service 在同一 Prisma 事务（`isolationLevel: 'Serializable'`）中执行；DB 唯一索引兜底关键唯一性。

| 编号 | 触发 | 规则 | 错误码 |
|---|---|---|---|
| R-01 | 客户 `unifiedSocialCreditCode` | 18 位 + GB 32100-2015 加权校验（Zod 自定义 `.refine`） | `CUSTOMER_CREDIT_CODE_INVALID` |
| R-02 | 客户 `→ SIGNED` | 至少一份 `ACTIVE` 合同 | `CUSTOMER_STATUS_INVALID` |
| R-03 | 新建合同 | 客户 `status ∈ {NEGOTIATING, SIGNED}` | `CONTRACT_CUSTOMER_STATUS` |
| R-04 | 合同 `→ ACTIVE` | 字段完整 + 至少 1 附件（`isPublishable`） | `CONTRACT_INCOMPLETE` |
| R-05 | 新建项目 | 所属合同 `status = ACTIVE` | `PROJECT_CONTRACT_NOT_EFFECTIVE` |
| R-06 | 项目 `endDate` | `≤ contract.endDate` | `PROJECT_DATE_OUT_OF_RANGE` |
| R-07 | 合同 `→ CLOSED` (auto completed) | `SUM(Invoice.ISSUED) ≥ totalAmount × completionInvoiceRatio` | `CONTRACT_NOT_COMPLETABLE` |
| R-08 | 开票 `submit/issue` | `SUM(已开票 ISSUED) + 当前 ≤ contract.totalAmount` | `INVOICE_OVER_LIMIT` |
| R-09 | 开票 `→ ISSUED` | 抬头/税号/电子发票号 20 位合规 | `INVOICE_INFO_INVALID` |
| R-10 | 回款 `→ CONFIRMED` | `bankRefNo` 全局唯一 | `PAYMENT_DUPLICATE_REF` |
| R-11 | 回款 `→ CONFIRMED` | 该发票下累计回款 ≤ 发票金额 | `PAYMENT_OVER_INVOICE` |
| R-12 | 回款 `→ CONFIRMED` | 合同级累计回款 ≤ 合同总额 | `PAYMENT_OVER_CONTRACT` |
| R-13 | 客户 `→ FROZEN` | 无 `ACTIVE` 合同 + 无 `PLANNED/CONFIRMED` 回款 | `CUSTOMER_HAS_ACTIVE_CONTRACT` / `CUSTOMER_FROZEN_ACTIVE_PAYMENT` |
| R-14 | 删除 | 终态记录禁止物理删除 | `ENTITY_IMMUTABLE` |
| R-15 | 用户 `DISABLED` | 名下 ACTIVE 合同需先转移 owner | `USER_HAS_ACTIVE_OWNERSHIP` |
| R-16 | 状态机迁移 | 强制走 Service；事务内 `Serializable` + 行锁；迁移表集中在 `lib/customer-status-transitions.ts` | `CUSTOMER_STATUS_TRANSITION_INVALID` |

> **错误码约定**：`{ENTITY}_{REASON}` 大写下划线；前端 ProForm `onFinish` 失败时按 `errorCode` 映射到 `errorCodeMessageMap` 文案 + 字段级错误从 `details.fieldErrors` 注入 ProForm `error`。

---

## 7. 消息提醒规则

| 事件 | 触发 | 接收人 | 模板 |
|---|---|---|---|
| `CONTRACT_PENDING_REVIEW` | 合同 `→ PENDING_REVIEW` | 审批人（默认 ADMIN） | 「合同 `{contractNo}` 等待您审批，签订日期 {signDate}」 |
| `CONTRACT_EXPIRING` | 定时任务：`endDate − 30/7/1` 天 | 业务负责人 + 管理员 | 「合同 `{contractNo}` 将于 {n} 天后到期」 |
| `INVOICE_OVERDUE_PAYMENT` | 定时任务：`actualIssueDate + 30` 天未全额回款 | 业务负责人 + 财务 | 「发票 `{invoiceNo}` 已开票 {n} 天，剩余未回款 ¥{amount}」 |
| `PAYMENT_RECEIVED` | 回款 `→ CONFIRMED` | 业务负责人 | 「客户 {customerName} 回款 ¥{amount} 已确认」 |
| `PROJECT_DUE` | 定时任务：项目 `endDate − 7` 天 | 项目负责人 + 业务负责人 | 「项目 `{projectNo}` 将于 {n} 天后计划完成」 |
| `CUSTOMER_INACTIVE` | 客户 90 天无 `FollowUp` 记录 | 业务负责人 | 「客户 {customerName} 已 90 天未跟进」 |
| `CUSTOMER_STATUS_SUGGEST` | 定时任务: 客户满足状态机联动规则 | 业务负责人 | 「建议将客户 {customerName} 状态变更为 {suggestedStatus}」 |

**实现**：领域事件总线（`src/server/events/bus.ts`）→ 消息 Worker（Next.js Route Handler + Vercel Cron / 外部 scheduler）→ 写 `Message` → 站内信（默认）/ 邮件 / 企业微信三通道（`config.notifications.{email,wechatWork}` 开关，默认关闭）。

---

## 8. 统计分析

### 8.1 指标口径

| 指标 | 公式 | 时间维度 |
|---|---|---|
| 合同额 | `SUM(Contract.totalAmount where status ∈ {ACTIVE,CLOSED})` | 月/季/年/任意区间 |
| 已开票额 | `SUM(Invoice.amount where status=ISSUED and actualIssueDate ∈ 区间)` | 同上 |
| 已回款额 | `SUM(Payment.amount where status ∈ {CONFIRMED,RECONCILED} and receivedAt ∈ 区间)` | 同上 |
| 未回款额 | 已开票额 − 已回款额 | 截止时点 |
| 开票率 | 已开票额 / 合同额 | 按合同/客户 |
| 回款率 | 已回款额 / 已开票额 | 按合同/客户 |
| 业务人员业绩 | 同上 + `ownerUserId=自己` | 月/季/年 |
| 客户分布 | `level/customerType/industry` 聚合 | 截止时点 |
| 应收账款账龄 | `0-30 / 31-60 / 61-90 / 90+` 分桶 | 截止时点 |

### 8.2 看板 / 导出
- 管理员/财务：合同/开票/回款总览、账龄、客户 Top10、员工 Top10。
- 业务人员：本人业绩 + 我的客户/合同/回款进度。
- 行政人员：基础信息统计（金额字段隐藏）。
- 导出：`exceljs@4.4.0` 流式生成；权限跟随 `EXPORT`；文件名 `统计报表_{from}_{to}.xlsx`。

---

## 9. 接口契约

> Next.js 16 Route Handlers（`app/api/.../route.ts`）；统一响应 `{ code: 0, data, message }` / 错误 `{ code: !=0, errorCode, message, details? }`。
> 列表统一参数 `page/pageSize/sort/keyword/filter[...]`；分页返回 `{ list, total, page, pageSize }`。
> 所有写接口使用 Zod（4.4.3）schema 校验；Service 入口 `schema.parse(input)`。

### 9.1 认证与会话
- `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me`

### 9.2 客户
- `GET/POST /api/customers`、`GET/PATCH /api/customers/:id`
- `POST /api/customers/:id/follow-ups`、`GET /api/customers/:id/contracts`

### 9.3 合同
- `GET/POST /api/contracts`、`PATCH /api/contracts/:id`
- `POST /:id/submit|approve|reject|withdraw|terminate`
- `GET /:id/projects|invoices|payments`

### 9.4 项目
- `GET/POST /api/projects`、`PATCH /api/projects/:id`
- `POST /:id/start|suspend|resume|deliver|accept|close|cancel|progress`

### 9.5 开票
- `GET/POST /api/invoices`、`PATCH /api/invoices/:id`（仅 DRAFT）
- `POST /:id/submit|issue|reject|void|red-flush`

### 9.6 回款
- `GET/POST /api/payments`
- `POST /:id/confirm|reconcile|refund|cancel|allocate`

### 9.7 统计
- `GET /api/statistics/overview?from&to&groupBy=month|customer|sales`
- `GET /api/statistics/invoice-aging`
- `GET /api/statistics/top-customers?metric=contract|payment&limit=10`
- `GET /api/statistics/employee-performance?userId=&from=&to=`

### 9.8 消息/公告
- `GET /api/messages?unread=true`、`PATCH /api/messages/:id`、`POST /api/messages/mark-all-read`
- `GET/POST /api/announcements`

### 9.9 基础数据
- `GET/POST/PATCH/DELETE /api/users|roles|dictionaries`（ADMIN）
- `GET /api/operation-logs`（ADMIN）

---

## 10. 前端架构（antd 6 + pro-components 3.x）

### 10.1 全局（实现期必须遵循）

1. **`app/layout.tsx`** 顺序：
   ```tsx
   <AntdRegistry>            {/* @ant-design/nextjs-registry */}
     <ConfigProvider locale={zhCN} theme={{ cssVar: true, hashed: false, token: {...} }}>
       <NextIntlClientProvider messages={...}> {/* 预留 */}
         <ProLayout>{children}</ProLayout>
       </NextIntlClientProvider>
     </ConfigProvider>
   </AntdRegistry>
   ```
2. **请求层**：`swr@2.4.1` + `fetch`，统一错误处理（`code !== 0` → `message.error`），401 跳登录。
3. **状态**：`zustand@5.0.14` 管理用户信息、字典缓存、消息未读数。
4. **字典**：`useDict(category)` Hook，登录后从 `/api/dictionaries` 拉取并按 `category` 缓存。
5. **权限**：`<Authority>` 组件（封装 `useAccess()`）按权限点控制按钮可见性；行级数据过滤由后端保证。
6. **图表**：`@ant-design/charts@2.6.7`，统计页统一封装 `<ChartCard>` 组件。

### 10.2 目录

```
/app
  layout.tsx
  page.tsx
  /login
  /dashboard
  /customers /contracts /projects /invoices /payments
  /statistics/{overview,aging,performance}
  /messages /announcements
  /admin/{users,roles,dictionaries,operation-logs}
/app/api/...
/components
  /pro-extensions/{EditableTable,ImportButton,ExportButton,StatusTag,ErrorCodeMessage}.tsx
  /charts
/lib
  /request.ts /auth.ts /prisma.ts /excel.ts /validators.ts /access.ts /dict.ts
/server
  /domain/{customer,contract,project,invoice,payment}/rules.ts
  /services/*
  /events/bus.ts
  /jobs/{contract-expiring,invoice-overdue,project-due,customer-inactive}.ts
/prisma
  schema.prisma migrations/ seed.ts
/types
```

### 10.3 关键页面组件约定
- **列表页**：`<ProTable request={...} toolBarRender columns>`；金额列 `valueType: 'digit'` + `render: (v) => formatRMB(v)`；日期 `valueType: 'dateTime'`；状态 `render: (_, r) => <StatusTag value={r.status} />`。
- **表单页**：`<ProForm formProps={{ layout: 'vertical' }}>` + `ProFormText/ProFormDigit/ProFormSelect/ProFormDatePicker/ProFormTreeSelect/ProFormUpload`；保存走 Server Action；服务端 `safeParseAsync` + `z.treeifyError` 错误回灌 ProForm `error`。
- **详情页**：`<ProDescriptions>` + Tabs（合同详情：项目 / 开票 / 回款 / 审计日志）。
- **审批流**：当前状态驱动动态按钮（`<Space><Button onClick={submit}>提交审批</Button>...</Space>`）；按钮包 `<Authority code="CONTRACT_APPROVE">`。
- **统计页**：`<ProCard split="vertical">` + `<StatisticCard>` + `@ant-design/charts`。
- **消息中心**：右上角铃铛 Badge + Drawer 列表；点击 `link` 跳详情页。

---

## 11. 关键测试用例

> Vitest 4.1.8 覆盖 Service/规则；Playwright 1.60.0 覆盖 E2E 审批/开票/回款关键链路。

1. **客户**：信用代码错误 → 400 `CUSTOMER_CREDIT_CODE_INVALID`；客户下无 ACTIVE/CLOSED 合同尝试 `→ SIGNED` 失败。
2. **合同**：缺附件/字段不完整时 `→ ACTIVE` 自动跳过（保持 DRAFT）失败；同客户下「同标题+同签订日」重复合同被拒；编号 `QT-HT-2025-0001` 并发生成无重复。
3. **项目**：合同非 ACTIVE 时禁止新建项目；项目 `endDate > contract.endDate` 被拒；`ACCEPTED` 之后才能让合同进入 CLOSED。
4. **开票**：已开票 90 万时再开 20 万 → 422 `INVOICE_OVER_LIMIT`；红冲后负数记录正确生成且原记录变 `RED_FLUSHED`，PLANNED Payment 自动 `CANCELLED`。
5. **回款**：`bankRefNo` 重复 → 409 `PAYMENT_DUPLICATE_REF`；同一发票累计回款超过发票金额 → 422；`RECONCILED` 记录尝试修改 → 403 `ENTITY_IMMUTABLE`；预收款无 invoiceId 时可入账并通过 `allocate` 拆分配。
6. **权限**：SALES 访问他人 `customerId` 详情 → 404；FINANCE 尝试改客户金额相关字段 → 403；OPS 在开票列表看不到任何记录；SALES 收件箱收不到非自己的 `MESSAGE`。
7. **消息**：`INVOICE_OVERDUE_PAYMENT` 在开票 +30 天自动创建对应 Message；标记已读后 `unreadCount` 正确。
8. **统计**：构造 1 个月数据，统计接口 `groupBy=month` 的「已开票额/已回款额」与 SQL 聚合一致（误差 0.01）；账龄分桶口径正确。
9. **审计**：所有状态机迁移在 `OperationLog` / `*AuditLog` 中留痕，含 `actorId` 与 `before/after diff`；密码/敏感字段永不入日志。
10. **前端 antd 6**：ProTable 分页/排序/筛选参数正确传递；按钮权限按 `<Authority>` 隐藏；金额格式 `¥1,234,567.00` 一致；`AntdRegistry` SSR 样式无首屏闪烁。

---

## 12. 实施路线

| 阶段 | 产出 | 验收 |
|---|---|---|
| **P0 脚手架** | Next.js 16 + TS 6 strict + Prisma 7 + NextAuth v4 + antd 6 + pro 3 + AntdRegistry；4 角色/字典种子；ESLint/Prettier/Typecheck/Test CI | `pnpm dev` 启动；4 角色可登录；首页 ProLayout 正常渲染；样式无闪烁 |
| **P1 主链路** | 客户/合同/项目/开票/回款 五大模块 CRUD + 状态机 + 关键校验 + ProTable/ProForm 页面 | §11 用例 1-6 全部通过；E2E 主链路 Playwright 全绿 |
| **P2 支撑** | 消息提醒（Vercel Cron + 站内信）、统计看板、xlsx 导出、操作日志 | §11 用例 7-9 全部通过；导出 1 万行统计 P95 < 2s |
| **P3 完善** | 通知三通道（邮件/企业微信，开关）、SSO 接入、备份脚本、压测报告 | 200 并发列表查询 P95 < 500ms |

---

## 13. Assumptions（默认决定，可改）

- **技术栈**：`next@16.2.7` + `react@19.2.7` + `typescript@6.0.3` + `antd@6.4.3` + `@ant-design/pro-components@3.1.12-0(beta)` + `prisma@7.8.0` + `next-auth@4.24.14` + `zod@4.4.3` + `vitest@4.1.8` + `@playwright/test@1.60.0`；包管理 **pnpm**。
- **pro-components beta 风险接受**：3.x 仍是 beta，承担小幅 API 变动风险；P0 阶段第一周做 antd 6 + pro 3 的"Hello ProTable"冒烟，验证 SSR 样式/React 19 兼容，再启动主链路开发。
- **数据库**：PG 16；金额 `numeric(18,2)`；时间 `timestamptz(6)`；启用 `pgcrypto`；**SALES 行级隔离用 RLS 兜底**（应用层 `SET LOCAL app.user_id`）。
- **业务编号**：`QT-{类型简码}-YYYY-####`；4 位年内流水；`Sequence` 表 + 行锁；默认全局递增。
- **税率**：默认 6%；可由合同覆盖。
- **电子发票号**：20 位数字（代码 12 + 号码 8），符合国标。
- **合同完成开票阈值**：默认 95%（`Contract.completionInvoiceRatio` 可调）。
- **认证**：账号密码 + 图形验证码（3 次失败 15 分钟锁定）；预留企业微信/SSO 接入位（不实现）。
- **审计**：所有状态流转、关键金额字段修改、终态记录操作入 `OperationLog` / `*AuditLog`，保留 5 年。
- **删除策略**：默认软删除（`deletedAt`）；终态记录禁止物理删除。
- **国际化**：默认 `zh-CN`；预留 `next-intl@4.13.0` 接入位。
- **安全**：密码 `bcrypt@6.0.0`；敏感字段（身份证/银行卡/税号）AES-256-GCM 加密存储；写接口 Zod 校验 + 权限校验。
- **部署**：默认 Vercel（应用）+ Neon（PG 16）；自托管 Docker Compose 在 P3 阶段提供。
- **不做**：本轮不写代码、不做 UI 设计稿（用 antd 6 默认主题）、不做移动端/小程序（仅 Web 响应式）、不实现 SSO/邮件/企业微信（仅保留配置位与 P3 钩子）。

---

> **下一步**：请您审阅本文档。重点确认：
> 1. **是否接受 pro-components 3.x beta 的不稳定风险**？若否，将方案降级为 antd 5.29.3 + pro 2.8.10（稳定组），其它版本保持。
> 2. §3 权限矩阵 + RLS 行级兜底是否合用？
> 3. §4 实体模型与字段（合同/开票/回款三块金额口径）是否完整？
> 4. §5 状态机的合法迁移是否覆盖实际操作？
> 5. §6 校验规则是否需要增减？
> 6. §13 默认假设里有没有需要调整的（编号规则、税率、阈值、SSO、部署方式）？
>
> 审阅通过后回复「按文档进入实现」即可进入 P0 脚手架阶段。

