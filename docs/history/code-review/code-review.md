# 代码审查报告 — P1 阶段

> 审查日期：2026-06-09  
> 代码库：/Users/yinchengchen/qt  
> 总规模：3922 行 TS/TSX（72 个源文件），含 18 张 Prisma 表 + 5 大模块  
> 总体评分：**合格**（架构清晰、规则齐备、状态机严格，但存在若干 P0 安全债务需在 P2 同期修复）

## 维度评分

| 维度 | 评分 | 关键问题 |
|---|---|---|
| 架构分层 | 优秀 | route → service → Prisma 事务 层次清晰；Zod 校验集中在 validators/ |
| 状态机 / 业务规则 | 优秀 | 16 条规则全部落地（E2E 27/27 验证） |
| 错误处理 | 良好 | `ApiError` + Zod 解析统一封装，500 路径不泄露堆栈 |
| 认证 / 授权 | 合格 | 鉴权链路完整；SALES 行级隔离基本到位，但有 1 处死代码/类型不一致需清理 |
| 数据完整性 | 优秀 | 软删除 `deletedAt` 全部过滤；Sequence 行锁保证并发 |
| 代码重复 | 合格 | 5 个 service 都有 `ownershipWhere` / `$transaction` 包裹 / `requireSession + try/catch + ok/err` 模板 |
| 性能 | 合格 | 大列表无 `select` 优化（拉整行）；无 N+1 但缺聚合索引 |
| 可测试性 | 合格 | Service 抽离到 `server/services/`，但路由层 try/catch 难复用 |
| **可观测性** | **需改进** | **OperationLog 没有任何写入点**（schema 有 18 张表里 18 是 OperationLog，但代码未使用） |

## P0 必修

### [P0-1] OperationLog 完全未使用
- **文件**: 无（schema 存在，业务代码无写入）
- **问题**: Prisma schema 里有 `OperationLog` 表，但 `rg "OperationLog" server/` 0 命中。所有状态机迁移、关键金额字段修改、用户登录/登出都未留痕，违反设计文档 §6 "审计"约定。
- **建议**: 在 `server/services/*.ts` 的状态机 `tx.update` 旁边统一插入 `tx.operationLog.create`；定义 `audit(tx, actorId, action, entity, entityId, before, after)` 工具函数。

### [P0-2] `requirePermission` 用 `require()` 同步引入 api.ts
- **文件**: `lib/permissions.ts:88-89`
- **问题**:
  ```ts
  const { ApiError } = require("./api");
  ```
  ESM 模式下 `require` 在 Turbopack 编译时能跑（已 work），但不是最佳实践；并且循环引用风险（api.ts 也可引用 permissions.ts）。
- **建议**: 改用顶部 `import { ApiError } from "./api"`。

### [P0-3] `Invoice / Payment` service 的 `ownershipWhere` 类型签名错误
- **文件**: `server/services/invoice.ts:9`, `server/services/payment.ts:10`
- **问题**:
  ```ts
  function ownershipWhere(user: SessionUser): Prisma.ContractWhereInput {
    return user.roleCode === "SALES" ? { ownerUserId: user.id } : {};
  }
  ```
  返回 `ContractWhereInput` 但 invoice/payment 表没有 `ownerUserId` 字段。当前实际 list 逻辑中**没有调用 `ownershipWhere`**，而是用手写的 `project: { contract: { ownerUserId: user.id } }`，所以**功能正常**；但函数本身是死代码 + 类型撒谎，未来重构时极易被错误地 spread 进 `Prisma.InvoiceWhereInput`，导致**行级隔离静默失效**。
- **建议**: 删除这两个未用的 `ownershipWhere` 函数；或重构为共享 `lib/access.ts` 工具：
  ```ts
  export const ownershipFilter = (user, relation: 'contract' | 'project.contract' | 'contract: { ... }') => ...
  ```

### [P0-4] `dashboard` 页面数据为硬编码
- **文件**: `app/dashboard/page.tsx`
- **问题**: 显示的 ¥1,265,600 / ¥893,200 等是写死的 fake 数据，但已经上线给所有登录用户。业务方看到会被误导。
- **建议**: 接入真实 `/api/dashboard/summary` 接口（计划在 P2 做）；临时方案：直接显示 "—" 占位。

### [P0-5] Prisma 7 已知问题：schema 中 `enum` 与 `@@index` 冲突
- **文件**: `prisma/schema.prisma` 顶部注释
- **问题**: 注释承认 Prisma 7 的 schema validator 在 wasm 端对 enum + 索引有 bug。Schema 已经绕过（用 `String` + TS 联合类型），但失去了 DB 层的 enum 约束。
- **建议**: 保留 String 方案（已 work），但 Zod schema 校验收紧（已做）；增加 Postgres CHECK 约束在 migration 后期通过 raw SQL 补齐。

## P1 重要

### [P1-1] 状态机迁移缺少 OperationLog / ProjectProgressLog 写入
- **文件**: `server/services/project.ts:140-145`（状态机），`server/services/invoice.ts:139-200`（state action）
- **问题**: project 状态机迁移（start/deliver/accept/close）只 update 状态，没写 ProjectProgressLog（虽然接口上有 `progress` 动作但状态机迁移时缺自动记录）。
- **建议**: 在 transitions 表里加 `audit: true`，事务内自动 `tx.projectProgressLog.create`。

### [P1-2] SALES 不能修改 `ownerUserId`（业务所需）
- **文件**: `server/services/customer.ts:83-101`
- **问题**: SALES 用 `customerUpdateSchema.partial()` 改客户，可改任何字段含 `ownerUserId`。管理员需要支持客户转移（如 R-15 客户名下有 EXECUTING 合同需先转移 owner）。
- **建议**: 在 `updateCustomer` 里增加 `if input.ownerUserId && user.roleCode !== 'ADMIN' throw FORBIDDEN`。

### [P1-3] 业务软删除未实现
- **文件**: 5 个 service
- **问题**: schema 里有 `deletedAt` 字段，但路由层没有 `DELETE` 方法（`/api/customers/:id` 等都没有 DELETE handler）。R-14 "终态禁止物理删除" 无对应接口。
- **建议**: P2 加 `DELETE /api/:resource/:id` 路由 → `softDelete(user, id)` service，统一软删 + 校验终态。

### [P1-4] payment amount 允许 0 但不允许负
- **文件**: `lib/validators/payment.ts:6`
- **问题**: 退款流程里 refund 用 `tx.payment.create({ amount: -Number(p.amount) })` 走 service，不走 Zod（无 Zod 校验）。Refunded 是 service 层 `tx.payment.create`，与 `paymentCreateSchema` 无关，逻辑 OK；但 API 上 `POST /api/payments` amount=0 会被 `refine(v !== 0)` 拒，amount 负数会被 Zod 接受（z.number() 不约束符号）。前端可以传负数。
- **建议**: `paymentCreateSchema.amount` 改为 `z.number().refine(v => v > 0)`。

### [P1-5] 错误日志含敏感数据
- **文件**: `lib/api.ts:44` `console.error("Unhandled API error:", e)`
- **问题**: 500 路径直接 `console.error(e)`，含完整 Prisma 错误对象（包括失败的 SQL、参数值）。在生产环境，攻击者引发 500 可能看到数据库结构。`createCustomer` 重复 `unifiedSocialCreditCode` 的错误就泄露了 schema。
- **建议**: 生产环境只打 `e.message` 或统一 hash 化；dev 才打 full object。

### [P1-6] `installmentPlan` 字段用 `as any`
- **文件**: `server/services/contract.ts:91, 120`
- **问题**: `installmentPlan: (input.installmentPlan ?? null) as any` 和 `attachments: input.attachments as any`——逃避 TS 类型检查。未来 schema 改字段会无感知。
- **建议**: 改成 `Prisma.JsonArray` 或 `Prisma.InputJsonValue`。

## P2 改进

### [P2-1] 路由模板代码重复
- **问题**: 22 个 route.ts 全部 `try { await requireSession(); const input = schema.parse(...); const data = await service(...); return ok(data); } catch (e) { return err(e); }`
- **建议**: 抽 `withSession(handler)` / `withJson(handler, schema)` 高阶函数。

### [P2-2] 列表查询无 `select`，拉整行
- **问题**: 5 个 list 函数都 `findMany({ where })`，N+1 风险（每行有 `customerName` 快照已避免，但 `contract` / `project` 等关系未 select 化）。ProTable 列越多，payload 越大。
- **建议**: 给每个列表接口加 `select: { ... }` 只取展示列；详情接口再 `include`。

### [P2-3] 字典接口无缓存
- **文件**: `app/api/dictionaries/route.ts`, `lib/dict-client.ts`
- **问题**: 客户端 `useDict` 已有内存缓存，但服务端 `findMany` 每次都查 DB（每页表格切换分类都打一次）。
- **建议**: Next.js fetch + `revalidate: 3600`。

### [P2-4] 缺 `instanceof Date` 防御
- **问题**: `tx.contract.update({ data: { ...input, signDate: input.signDate ? new Date(input.signDate) : undefined } })`——Zod 已经解析为 string，如果输入已 Date 则 `new Date(date)` 无害；如果 string 非法会被 Zod 拦下。**当前 OK**，但若 service 被内部其他模块调用（绕开 Zod）则可能 NaN。
- **建议**: 在 service 入口加 `z.coerce.date()` 二次校验。

### [P2-5] `prisma.config.ts` 未提交
- **文件**: `prisma.config.ts` 是 Prisma 7 必需（包含 datasource URL）
- **问题**: 当前存在，但 `.gitignore` 默认会忽略 .env 风格配置文件，团队成员克隆后可能漏配。
- **建议**: 文档化启动步骤（README 已有 ✓）。

### [P2-6] 缺 i18n 实际接入
- **设计**: §13 假设预留 next-intl 4.13.0
- **实际**: 只装了包，没配置 `next-intl` plugin
- **建议**: P2 或 P3 阶段决定；当前所有文案硬编码 zh-CN。


## 亮点

- **状态机严格性**：所有迁移都强制走 Service（`tx.contract.update`）；路由层不直接 Prisma。
- **行锁编号**：`Sequence` 表 + `SELECT … FOR UPDATE` 保证并发安全（不依赖 Prisma `upsert` 的隐式事务）。
- **软删除全局一致**：所有 list / get / update 都 `where: { deletedAt: null }`。
- **API 错误统一**：`err()` 区分 ApiError / Zod / 其他，500 不泄露堆栈到 client。
- **审计日志已建模**：`ContractReviewLog` / `InvoiceAuditLog` / `ProjectProgressLog` 都在事务内同步写入。
- **Zod 4 + Prisma 7 + Next 16 + RSC 协同**：技术栈前沿，TS 0 错误，build 通过。
- **27/27 E2E 全绿**：覆盖 5 大模块 + 16 条跨模块规则 + 状态机迁移 + 行级隔离 + 业务编号。

## 修复优先级建议

| 优先级 | 编号 | 修复时间 | 修复点 |
|---|---|---|---|
| **P0-1** | OperationLog | P2 内 | 状态机统一落库 |
| **P0-2** | require 改 import | 5 分钟 | lib/permissions.ts |
| **P0-3** | 死代码 ownershipWhere | 10 分钟 | invoice.ts / payment.ts |
| **P0-4** | Dashboard 硬编码 | P2 | 接入真实数据 |
| **P0-5** | enum CHECK 约束 | P3 | raw SQL |
| **P1-1** | 状态机审计 | P2 | project.ts |
| **P1-2** | ownerUserId 改 | P2 | customer.ts |
| **P1-3** | 软删 DELETE | P2 | 5 service + 5 route |
| **P1-4** | amount>0 校验 | 5 分钟 | payment validator |
| **P1-5** | 错误日志脱敏 | 30 分钟 | api.ts |
| **P1-6** | as any 清理 | 1 小时 | contract.ts 等 |
| **P2-*** | 重构/优化 | P3 | – |

