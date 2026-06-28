# 客户状态机下线 (Customer Status Machine Deprecation)

**作者**: Codex
**日期**: 2026-06-29
**状态**: Design Draft (待 review)
**关联**:
- 上线文档 [2026-06-28-customer-status-automation.md](2026-06-28-customer-status-automation.md) (本 spec 反向清理其影响)
- 实施 v0.4.0 提交 `45dcfcd` (feat) + `64469f8` (docs) + `e60f60a` (docs 精简)

## 1. 背景与目标

### 1.1 现状
v0.4.0 上线了完整的客户状态机体系:
- 5 态枚举 (LEAD / NEGOTIATING / SIGNED / LOST / FROZEN) + 状态机迁移表
- 4 条自动规则 (CONTRACT_ACTIVATED / ALL_CONTRACTS_CLOSED / INACTIVE_LOST / INACTIVE_FROZEN)
- 7 天异议窗口 + 详情页撤销横幅
- 业务事件 hook (合同 DRAFT->ACTIVE / ACTIVE->CLOSED 触发客户状态机)
- 跨模块校验 R-02 / R-13 / R-13b-e
- 站内信 3 个事件 (CUSTOMER_STATUS_SUGGEST / AUTO_APPLIED / AUTO_REVERTED)
- 客户列表状态筛选、详情页状态标签 + 变更 Popover

业务方反馈: 5 态语义与销售实际工作流脱节, 90 / 60 天自动改 LOST/FROZEN 误判率高, 7 天撤销横幅对销售造成干扰。决定**完全下线整个客户状态及状态机体系**。

### 1.2 目标
- **G1**: 删 Customer.status / lastAutoAppliedAt / lastAutoRule 3 列, 客户失去状态概念
- **G2**: 删状态机迁移表 + 手动状态变更 API/UI
- **G3**: 删 v0.4.0 自动化 (4 条规则 + 撤销横幅 + 触发的 lastAutoAppliedAt/lastAutoRule 两列)
- **G4**: 删 R-02 / R-13 / R-13b-e 跨模块校验 (业务语义随 status 一起消失)
- **G5**: 删 CUSTOMER_STATUS_SUGGEST 站内信 (业务上不再有 "N 天无活动提醒")
- **G6**: 删客户列表 status 筛选 + 详情页状态标签 + 变更弹窗
- **G7**: 保留 MessageType enum 里 CUSTOMER_STATUS_SUGGEST / AUTO_APPLIED / AUTO_REVERTED 3 个值 (历史消息可读, PG 不允许 DROP VALUE)
- **G8**: 保留 CUSTOMER_STATUS_CHANGE / AUTO_CHANGE / REVERT 3 个 audit action 字符串 (历史 OperationLog 可读)

### 1.3 非目标
- 不动合同状态机 (DRAFT / ACTIVE / CLOSED)
- 不动发票/回款/支付状态
- 不动 FollowUp 表 (已于 2026-06 软下线, 表结构保留, 与本 PR 无关)
- 不删历史 OperationLog (历史数据可读, 后续由 retention job 清理)
- 不改后端 v0.4.0 之前已存在的行为 (业务上 status 一直是 String 而非 enum, 无遗留)

## 2. 设计

### 2.1 Schema 改动

**Customer 表** 删 3 列:
- status: String @default("LEAD") - 删
- lastAutoAppliedAt: DateTime? - 删
- lastAutoRule: String? - 删
- @@index([status]) - 删 (依赖 status 列)

status 列从 v0.4.0 上线起就 String 而非 CustomerStatus enum, drop column 干净, 不需 backfill。

新迁移 `prisma/migrations/20260629_drop_customer_status/migration.sql`:
```sql
DROP INDEX IF EXISTS "Customer_status_idx";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "status";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "lastAutoAppliedAt";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "lastAutoRule";
```

**MessageType enum** 保留 3 个值 (PG 不支持 ALTER TYPE DROP VALUE, 删会失败):
- CUSTOMER_STATUS_SUGGEST - 保留 (历史消息有引用)
- CUSTOMER_STATUS_AUTO_APPLIED - 保留
- CUSTOMER_STATUS_AUTO_REVERTED - 保留

不再 emit 这 3 种 type, 历史消息在 Message 表里仍可读, 渲染时 fallback 到通用 title。

### 2.2 核心库删除

| 文件 | 操作 | 备注 |
|---|---|---|
| `lib/customer-status-transitions.ts` | **删** (174 行) | 整个状态机迁移表 |
| `lib/customer-auto-rules.ts` | **删** (149 行) | 4 条规则配置中心 |
| `lib/customer-update.ts` | 改 | 删 // status 走 changeCustomerStatus 注释; 函数本身保留 |
| `lib/status.ts` | 改 | 删 StatusDomain 联合里的 "customer"; 删 CUSTOMER 字典; 删 DOMAIN_MAP.customer |
| `lib/dict-domain.ts` | 改 | 删 CUSTOMER_STATUS 字典类别配置 (line 54) |
| `lib/dictionary-categories.ts` | 改 | 删 CUSTOMER_STATUS 类别 (line 11, 33) |
| `lib/use-status-enum.ts` | 改 | 删 customer domain 支持 (要查具体用法) |
| `lib/validators/customer.ts` | 改 | 删 customerUpdateSchema 的 status + reason 字段; 删 customerRevertSchema 整段; 删 customerExportSchema 的 status 字段 |
| `lib/env.ts` | 改 | 删 CUSTOMER_AUTO_* 4 个字段 (line 38-46, 66-69) |

### 2.3 Server 改动

| 文件 | 操作 | 备注 |
|---|---|---|
| `server/services/customer/automation.ts` | **删** (49 行) | 整个文件, 包含 onContractActivated / onContractClosed |
| `server/services/customer/status.ts` | **删** (300+ 行) | 含 changeCustomerStatus + autoChangeCustomerStatus + revertCustomerStatus 3 个函数 |
| `server/services/customer/crud.ts` | 改 | 删 onContractActivated / onContractClosed 引用 (3 处) |
| `server/services/contract/crud.ts` | 改 | 删 2 处 await onContractActivated(id) (line 244, 327) |
| `server/services/contract/status.ts` | 改 | 删 2 处 await onContractClosed(contractId) (line 265, 337) |
| `server/jobs/customer-status-suggest.ts` | **删** (231 行) | 整个文件, 时间窗 job + SUGGEST 消息 emit |
| `server/jobs/runner.ts` | 改 | 删 customer-status-suggest job 注册 |
| `app/api/jobs/[job]/route.ts` | 改 | 删 customer-status-suggest 分支 |
| `server/events/bus.ts` | 改 | 删 CUSTOMER_STATUS_SUGGEST / AUTO_APPLIED / AUTO_REVERTED 3 个 case (line 78, 144, 154) |
| `types/enums.ts` | 改 | 删 CUSTOMER_STATUS 数组 + CustomerStatus 类型; MessageType enum 保留 3 个 deprecated 值 |
| `types/errors.ts` | 改 | 删 7 条错误码 (见 2.6) |

### 2.4 API 改动

| 路由 | 操作 | 备注 |
|---|---|---|
| `app/api/customers/[id]/revert/route.ts` | **删** | 整个文件 |
| `app/api/customers/[id]/route.ts` | 改 | 删 status 路由逻辑 (line 38-44) - 不再调 changeCustomerStatus |
| `app/api/customers/export/route.ts` | 改 | 删 status 字段 (line 33 入参, line 103 列定义) |
| `app/api/customers/[id]/pdf/route.ts` | 改 | 删 subtitle 里的 "状态 ${label("CUSTOMER_STATUS", c.status)}" (line 56); 删 CUSTOMER_STATUS_MAP 拼装 (line 51) |
| `app/api/statistics/overview/route.ts` | 改 | 删 customer status 聚合 (如有, 需要再 grep 一次确认) |

### 2.5 UI 改动

| 文件 | 操作 | 备注 |
|---|---|---|
| `app/(app)/customers/page.tsx` | 改 | 删 status 列 + 筛选 (line 28, 46, 203, 311-314) |
| `app/(app)/customers/[id]/page.tsx` | 改 | 删 lastAutoAppliedAt / lastAutoRule 字段; 删 AutoStatusBanner 引用; 删状态变更 Popover + Popover state; 删 line 145 状态列 |
| `app/(app)/customers/[id]/edit/page.tsx` | 改 | 删 status 字段 (如果存在) |
| `components/customers/auto-status-banner.tsx` | **删** (179 行) | 整个文件 |
| `components/customers/customer-form.tsx` | 改 | 删 status 字段 (line 19-21, 31, 62, 64, 71-77, 97, 209-212) |
| `components/status-tag.tsx` | 不动 | 通用组件, 仅失去 customer domain 用法 |

### 2.6 错误码删除

`types/errors.ts` 删 7 条:
- CUSTOMER_STATUS_INVALID
- CUSTOMER_HAS_ACTIVE_CONTRACT
- CUSTOMER_STATUS_TRANSITION_INVALID
- CUSTOMER_FROZEN_ACTIVE_PAYMENT
- CUSTOMER_STATUS_REASON_REQUIRED
- CUSTOMER_AUTO_DISPUTE_EXPIRED
- CUSTOMER_AUTO_REVERT_TARGET_INVALID

错误码定义 + 错误消息双语 2 处都删。

### 2.7 Env 改动

`lib/env.ts` + `.env.example` 删 4 字段:
- CUSTOMER_AUTO_RULES_DISABLED
- CUSTOMER_AUTO_DISPUTE_DAYS
- CUSTOMER_AUTO_INACTIVE_LOST_DAYS
- CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS

### 2.8 审计与消息保留

**保留** (历史数据可读):
- `OperationLog.action` = CUSTOMER_STATUS_CHANGE / AUTO_CHANGE / REVERT - 历史记录保留
- `Message.type` = CUSTOMER_STATUS_SUGGEST / AUTO_APPLIED / AUTO_REVERTED - 历史消息保留, 渲染 fallback

**停止 emit**:
- 不再调用 audit(action: "CUSTOMER_STATUS_*")
- 不再调用 emit(type: "CUSTOMER_STATUS_*")
- bus.ts 的 3 个 case 删掉, 历史消息靠 default fallback 处理 (见 3.2)

## 3. 数据迁移

### 3.1 字段 drop

新 migration `20260629_drop_customer_status` 一把 drop, 不需 backfill:
- status 列从 v0.4.0 起默认值 "LEAD", 历史值有自动化写入的 (SIGNED / LOST / FROZEN), drop 后全部消失
- lastAutoAppliedAt / lastAutoRule 都是 nullable, drop 干净

### 3.2 历史数据可读性

- OperationLog 表里有历史 CUSTOMER_STATUS_* audit, 保留可读
- Message 表里有历史 CUSTOMER_STATUS_* 消息, 保留可读
- bus.ts 删 case 后, 历史消息渲染走 default (目前是 assertNever, 会抛错) - **需要改**:
  - 选项 A: default 改 fallback 到 "type: {ev.type}" 通用渲染
  - 选项 B: 历史消息渲染用 Message.type 直接查表
  - 推荐 A, 简单且不影响新功能

### 3.3 业务数据影响

| 业务场景 | 当前 | 下线后 |
|---|---|---|
| 客户列表筛选状态 | status 列 | 删 |
| 详情页看客户状态 | 头部 StatusTag | 删 |
| 编辑页改客户状态 | 状态下拉 | 删 |
| 合同生效自动改 SIGNED | 业务事件 | 删, 改走人工 (业务方后续定义) |
| 90 天无活动自动 LOST | 时间窗 | 删, 改走人工 |
| 60 天无活动自动 FROZEN | 时间窗 | 删, 改走人工 |
| 7 天撤销 | 详情页横幅 | 删 |
| SUGGEST 站内信 | 时间窗 | 删 |

## 4. 测试

### 4.1 删

| 文件 | 操作 |
|---|---|
| `tests/unit/lib/customer-status-transitions.test.ts` | **删** |
| `tests/unit/lib/customer-auto-rules.test.ts` | **删** |
| `tests/unit/lib/customer-update.test.ts` | 改 (去掉 status 路由测试) |
| `tests/unit/server/customer-status-automation.test.ts` | **删** |
| `tests/unit/server/customer-status-suggest.test.ts` | **删** |
| `tests/unit/server/customer-status.test.ts` | **删** |
| `tests/api/customers-patch.test.ts` | 改 (去掉 status 相关用例) |
| `tests/e2e/08-customer-status.spec.ts` | **删** |

### 4.2 新增

- `tests/unit/lib/customer-update.test.ts` - 加 1 个用例: buildCustomerUpdateData 输入含 status 字段时不写入 data
- 跨模块 R-02 / R-13 校验删除后, 相关的 contract 提交流程测试 (如果有) 应当仍然全绿 (因为原本的 reject path 没了, 通过路径不变)

### 4.3 回归

- `npx tsc --noEmit` 必须通过
- `npm run lint` 必须通过
- `npx vitest run` 必须通过 (删除的测试文件不计入)
- `npm run test:e2e` (Playwright) - 08-customer-status.spec.ts 已删, 其它 spec 不应受影响 (没改其它模块)

## 5. 风险与回退

### 5.1 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 业务方误以为 status 还在 | 高 | USER_MANUAL 5.6 删, README 状态表删, 客户列表 status 筛选/列删 |
| 合同 DRAFT->ACTIVE 后客户无状态变化, 业务方需要新流程 | 中 | 留给业务方后续设计, 当前 PR 不补 |
| PG enum DROP VALUE 不支持, 3 个 MessageType 值保留 (技术债) | 低 | 接受, 文档说明, 后续 retention job 清 |
| 历史 OperationLog 渲染时 action 字符串已无对应 handler | 中 | OperationLogDrawer 渲染 fallback (需查具体代码) |
| lib/status.ts 删 customer 后, useStatusValueEnum("customer") 调用方 (列表页) 报错 | 高 | 列表页 status 列先删, 再删 lib/status.ts 字段 |
| bus.ts 删 case 后, 历史消息渲染抛 assertNever | 高 | 改 default 为 fallback title (见 3.2) |
| Customer 表上 @@index([status]) 删时若 Prisma 报 index not found | 低 | migration 用 DROP INDEX IF EXISTS |

### 5.2 回退

- 本 PR 是不可逆的 schema drop, 不可回退
- 实施前先用 prisma migrate diff 预览生成的 SQL
- 灰度建议: dev -> staging -> prod, 每一档停 1 天观察

## 6. 落地步骤 (高层)

```
Step 1  schema: 删 Customer.status / lastAutoAppliedAt / lastAutoRule / @@index([status]) - Prisma schema 改
Step 2  migration: prisma migrate dev 生成 drop migration
Step 3  lib: 删 customer-status-transitions.ts / customer-auto-rules.ts; 改 lib/status.ts / dict-domain.ts / dictionary-categories.ts / use-status-enum.ts / env.ts / validators/customer.ts / customer-update.ts
Step 4  server services: 删 customer/automation.ts / customer/status.ts; 改 customer/crud.ts / contract/crud.ts / contract/status.ts / jobs/customer-status-suggest.ts / jobs/runner.ts
Step 5  API: 删 customers/[id]/revert/route.ts; 改 customers/[id]/route.ts / customers/export/route.ts / customers/[id]/pdf/route.ts / jobs/[job]/route.ts
Step 6  UI: 删 components/customers/auto-status-banner.tsx; 改 customers/page.tsx / customers/[id]/page.tsx / customers/[id]/edit/page.tsx / customers/customer-form.tsx
Step 7  types/events: 改 types/enums.ts (删 CustomerStatus, 保留 MessageType deprecated 值); types/errors.ts (删 7 错误码); events/bus.ts (删 3 case, default fallback title)
Step 8  tests: 删 6 个测试文件; 改 2 个; 加 1 个 buildCustomerUpdateData 新用例
Step 9  docs: 删 spec / DESIGN-v3 §5.5 / PROJECT_SUMMARY §3.3.2 / USER_MANUAL §5.6; 改 README 状态表
Step 10 env: 改 .env.example 删 4 字段
Step 11 验证: tsc / lint / vitest / Playwright (跳 08)
Step 12 提交: feat(customer): 删 status 字段 + 状态机 + 自动化 (硬下线)
```

## 7. Assumptions (默认决定)

- A1: 业务方确认 status 概念不再需要, 不补 "新状态" 概念
- A2: 合同 DRAFT->ACTIVE 不再触发任何客户状态变化, 业务方后续自己定义流程
- A3: 历史 OperationLog + Message 保留, 渲染 fallback 即可
- A4: MessageType enum 的 3 个 deprecated 值保留, PG 不支持 DROP VALUE
- A5: 不补 backfill (status 列有历史值, drop 后丢失, 业务方接受)
- A6: 1 次性 commit, 不分多 PR
- A7: dev 环境先合, 观察 1 天再合 main
