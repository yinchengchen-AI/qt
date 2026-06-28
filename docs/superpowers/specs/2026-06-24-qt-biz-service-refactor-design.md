# qt-biz 五模块 service 层主题重构设计

> ⚠️ **历史注脚 (2026-06-29, v0.5.0)**：本设计为 v0.3.0 历史产物,文中提及的 `changeCustomerStatus` / R-02 / R-13 等已在 v0.5.0 客户状态机下线时整体移除 (`docs/superpowers/specs/2026-06-29-customer-status-deprecation.md`),仅作历史参考。本设计其它 lib 抽象 (`status-machine` / `money` / `money-tolerance` / `attachment-snapshot` / `soft-delete` / `known-keys`) 仍为现行架构。

| 项 | 值 |
|---|---|
| 日期 | 2026-06-24 |
| 状态 | 待 review |
| 范围 | service / lib 层 9 条债务,6 个独立可合 PR |
| 目标版本 | qt-biz v0.3.x(与当前 main 一致) |
| 落地策略 | **II · 分阶段主题重构**(按 14 条债务清单逐条消除,合并为 6 个 PR) |

## 1. 背景与目标

### 1.1 现状速记

**代码体量(2026-06-24 统计)**
- 5 个 service 文件: `contract.ts` 928 / `customer.ts` 508 / `invoice.ts` 455 / `payment.ts` 243 / `user.ts` 278,合计 2412 行
- 5 个详情页:`customers/[id]` 534 / `contracts/[id]` 517 / `admin/users` 386 / `invoices/[id]` 134 / `payments/[id]` 167
- 14+ 个 route 文件平均 30-50 行,`pdf` route 单独 180-200 行
- 20 个 API 集成测试 / 8 个 service 单元测试(已 142 用例全绿)

**已完成的近期重构**
- 2026-06-23 合同状态机 7→3 收敛
- 2026-06-23 项目 / 工作流 / 资产库 3 个大模块整体下线
- 2026-06-24 统计分析 round-2 收口(H1-H5 / M1-M4 / L1-L3 / L6 修复)

**显性技术债(14 条)**
1. `contract.ts` 928 / `customer.ts` 508 / `invoice.ts` 455 单文件过重,职责混合
2. 状态机 boilerplate 三重重复(`tryAutoPublish` / `tryAutoCloseOnExpiry` / `tryAutoComplete` 95% 雷同)
3. 附件快照解析两份(contract / invoice 各 ~80 行,只差参数名)
4. 金额计算两份实现(contract 走 `Math.round` 浮点,invoice 走 `Prisma.Decimal` 精确)
5. 容差 `0.01` 3 处字面量(contract-billing `TOLERANCE` / invoice / payment)
6. route handler 14+ 处 boilerplate 几乎逐字相同
7. PDF route 196+180=376 行混关注点(HTML 渲染 + Prisma 反查 + fmt)
8. softDelete 4 步法不统一(contract 走 Serializable, customer 没)
9. 角色判断 4+ 处直接 `user.roleCode === "ADMIN"` 字符串
10. 24+ 处裸 `await fetch(...)` 绕过 `use-action-call`
11. 两个详情页 500+ 行重复主数据+子表+Tabs+按钮+状态动作
12. 5+ 处 `useSWR` + `useState` 翻页与 `useListRequest` 重复
13. 状态机 / 软删 / 金额 0 个 service 单元测试
14. `KNOWN_KEYS` 与各 service where 字段独立维护,加新筛选维度改 3 处

### 1.2 目标

- **认知负担**:新人打开 `server/services/contract.ts` 不再被 ~30 个混杂函数压垮,5 个模块的最大 service 文件 < 350 行
- **重复代码归零**:状态机 6 步动作(读 → 校验 → update → reviewLog → audit → emit)从 5+ 处复制收敛到 1 处抽象;附件快照从 2 份合并到 1 份;金额计算从 2 份统一到 1 份
- **风险可见**:每个抽象自带单元测试,行为变更前能在 PR 看到 diff;20 个 API 集成测试 0 回归是合并门槛
- **可演进**:后续加新的状态机迁移只写 6 个钩子(loadInTx / precondition / extraData / audit / reviewLog / event),不再调 prisma 内部

### 1.3 非目标

- 不改 Prisma schema / 任何迁移
- 不改任何 API 契约(route 行为 0 变化)
- 不改任何状态机语义(DRAFT/ACTIVE/CLOSED 迁移路径、auto 触发条件、emit payload 保持)
- 不改任何前端 URL 与查询参数
- 不改权限矩阵(`lib/permissions.ts:ROLE_PERMISSIONS` 冻结)
- 不做 #6 / #7 / #10 / #11 / #12(路由 / PDF / 详情页 / 裸 fetch / useListRequest 留到下一轮)
- 不引入新依赖

## 2. 范围

### 2.1 在本轮做(In) — 9 条债务,6 个 PR

| 债务 | 主题 | PR | 新 lib / 改动 |
|---|---|---|---|
| #2 + #9 | 状态机收敛 + 角色常量 | **PR1** | 新 `lib/status-machine.ts` |
| #3 + #4 + #5 | 金额 + 附件 + 容差去重 | **PR2** | 新 `lib/money.ts` `lib/money-tolerance.ts` `lib/attachment-snapshot.ts` |
| #1 | service 文件拆分 | **PR3** | contract → 5 文件;customer → 4;invoice → 3;barrel re-export |
| #8 | 软删统一 | **PR4** | 新 `lib/soft-delete.ts` |
| #13 | 状态机 / 软删 / 金额单测 | **PR5** | 新 `tests/unit/lib/{status-machine,soft-delete,money}.test.ts` |
| #14 | 白名单自动推导 | **PR6** | 新 `lib/known-keys.ts`;`use-list-request.ts` 改用 |

### 2.2 不在本轮做(Out) — 5 条债务,下一轮 spec

| 债务 | 主题 |
|---|---|
| #6 | route handler 14+ 处 boilerplate 工厂化 |
| #7 | PDF route 拆出 service / 工具 |
| #10 | 24+ 裸 fetch 全部走 `use-action-call` |
| #11 | `<ResourceDetailPage>` 详情页壳 |
| #12 | `useListRequest` 推到全站 |

(本轮 spec 仅列出 5 条 + 当前 6 个 PR,下一轮 spec 继承)

## 3. PR 序列与依赖

**实际依赖**:
- PR1 / PR2 / PR4 / PR6 互相独立(各自只新增 lib + 切换调用方)
- PR3 依赖 PR1 + PR2 + PR4(因为它要拆分这 3 个 PR 改过的 service 文件,先稳定再拆)
- PR5 依赖 PR1 + PR2 + PR4(测试 3 个新抽象)

```
       ┌─ PR1 状态机收敛(0.5d, +120 lib / −90 service)
       │
       ├─ PR2 金额/附件/容差(0.5d, +90 lib / −110 service)
并 行 ─┤
       ├─ PR4 软删统一(0.5d, +60 lib / −40 service)
       │
       └─ PR6 白名单(0.25d, +20 lib / −15 use-list-request)
                │
                └─ PR3 service 拆分(1.0d,纯移动 + barrel)— 依赖 PR1+PR2+PR4 全部合入
                            │
                            └─ PR5 单测(0.5d, +36 tests)— 依赖 PR1+PR2+PR4
```

**总估时**:3.25 个工作日,6 个独立可合 PR。

**合 PR 顺序建议**:PR1 + PR2 + PR4 + PR6 并行(4 个 worktree)→ PR3 → PR5。

## 4. 关键抽象(4 个新 lib + 1 个白名单工具)

### 4.1 `lib/status-machine.ts` — 服务 PR1

```ts
// 嵌在外层事务内(由 createContract / updateContract 等触发)
export async function runTransitionInTx<C extends { id: string; status: string }>(
  tx: Prisma.TransactionClient,
  input: {
    entity: "Contract" | "Customer" | "Invoice" | "Payment";
    loadInTx: (tx: Prisma.TransactionClient) => Promise<C | null>;
    from: readonly string[];
    to: string;
    precondition?: (current: C) => void | Promise<void>;
    extraData?: (current: C) => Record<string, unknown>;
    audit: (current: C) => { actorId: string; action: string; before: object; after: object };
    reviewLog?: (current: C) => { action: string; comment?: string | null; reviewerId: string };
    event?: (current: C) => { type: string; payload: object; receivers: string[] };
    silentSkip?: boolean;
  }
): Promise<"DONE" | "SKIPPED">;

// 单独事务跑(自动迁移) — Serializable + P2034 重试 3 次
export async function runTransition<C extends { id: string; status: string }>(
  input: { ... } & { id: string }
): Promise<"DONE" | "SKIPPED">;
```

**吃掉**:`tryAutoPublish` / `tryAutoCloseOnExpiry` / `tryAutoComplete` 3 个 ~50 行函数;`customer.ts:changeCustomerStatus` 的事务与重试样板;`invoice.ts:invoiceAction` 5 个 arm 的事务样板;`payment.ts:paymentAction` 4 个 arm 的事务样板。**净减约 250 行**。

**保留差异**:每处仍由 caller 写 6 个钩子;不同业务的差异(closeContract 写 `reviewComment`、changeCustomerStatus 校验 R-02/R-13、invoice action 的 5 路)依然在 caller 处,不被遮蔽。

**已知限制**:`updateByEntity` 需要按 `entity` 字段做 4 路 dispatch(Prisma 的 `model.update` 是 per-model 类型);库内 switch 处理,不影响 caller。

### 4.2 `lib/money.ts` + `lib/money-tolerance.ts` — 服务 PR2

```ts
// lib/money.ts
export function calcTaxBreakdown(
  totalAmount: Prisma.Decimal | number | string,
  taxRate: Prisma.Decimal | number | string,
): { totalAmount: Prisma.Decimal; taxAmount: Prisma.Decimal; amountExcludingTax: Prisma.Decimal };

export function isOverAmount(
  sum: Prisma.Decimal | number | string,
  add: Prisma.Decimal | number | string,
  cap: Prisma.Decimal | number | string,
  tolerance?: Prisma.Decimal,
): boolean;  // sum + add > cap + tolerance
```

```ts
// lib/money-tolerance.ts
export const MONEY_TOLERANCE = new Prisma.Decimal("0.01");
```

**吃掉**:`contract.ts:calcTotals`(用 `Math.round(v*100)/100`,有浮点漂移)+ `invoice.ts:calcTotals`(用 Prisma.Decimal,正确)→ 统一到 `calcTaxBreakdown`;`invoice.ts` / `payment.ts` 3 处 `new Prisma.Decimal("0.01")` + `contract-billing.ts:TOLERANCE = 0.01` → 全部走 `MONEY_TOLERANCE`。

**净效果**:合同侧 4 处浮点比较从 `Number > Number` 变成 `Decimal.compareTo(Decimal)`,与发票侧 0 漂移;容差字面量从 4 处收敛到 1 处。

### 4.3 `lib/attachment-snapshot.ts` — 服务 PR2

```ts
export type AttachmentBind = "Contract" | "Invoice";

export async function resolveAttachmentSnapshots(
  raw: RawAttachment[],
  bind: AttachmentBind,
  entityId: string,
  tx: Prisma.TransactionClient,
): Promise<Prisma.InputJsonValue>;
```

**吃掉**:`contract.ts:resolveAttachmentSnapshots`(80 行,绑 contractId)+ `invoice.ts:resolveInvoiceAttachmentSnapshots`(80 行,绑 invoiceId)。统一用 `bind: "Contract" | "Invoice"` 区分;legacy 前缀 / 上限 5 个 / `tx.attachment.findMany` 查 / 拒绝越权 / 按原顺序合并 这套逻辑两处完全一致,合并到 1 处。**净减约 60 行**。

### 4.4 `lib/soft-delete.ts` — 服务 PR4

```ts
export type SoftDeleteSpec = {
  entity: "Contract" | "Customer" | "Invoice" | "Payment";
  findInTx: (tx: Prisma.TransactionClient, id: string) => Promise<{ id: string } | null>;
  updateInTx: (tx: Prisma.TransactionClient, id: string, deletedAt: Date, actorId: string) => Promise<{ id: string }>;
  preDeleteCheck: (tx: Prisma.TransactionClient) => Promise<void>;
  audit: { actorId: string; before: Record<string, unknown> };
};

export async function softDelete(
  user: SessionUser,
  spec: SoftDeleteSpec & { id: string },
): Promise<{ id: string }>;
```

**吃掉**:`softDeleteContract`(Serializable + 3 次重试 + 子数据校验)+ `softDeleteCustomer`(无 Serializable)+ 软删通用样板。统一 Serializable + 3 次重试 + 统一 `ENTITY_IMMUTABLE` 错误码。

**已知限制**:`findInTx` / `updateInTx` 是 model 相关的,caller 写 `tx.contract.findFirst` 之类;库不感知 model。代价是样板略多 2 行,收益是类型完全保留。

### 4.5 `lib/known-keys.ts` — 服务 PR6

```ts
import type { ZodObject } from "zod";
export function deriveKnownKeys(schemas: ZodObject[]): Set<string>;
```

**前置**:`lib/validators/{customer,contract,invoice,payment,user}.ts` 各自把 `listQuery` 提为 `export const *ListQuerySchema`(目前 4 个是路由内 inline,需要先 export)。

**吃掉**:`use-list-request.ts:KNOWN_KEYS` 14 项手维护集合,改成 `deriveKnownKeys([customerListQuerySchema, ...])`。加新筛选维度只需改 zod schema,use-list-request 自动跟着走。

## 5. 测试策略(PR5)

### 5.1 测试模式(沿用项目现有)

- **service / lib 单元测试**:`vi.mock("@/lib/prisma", ...)` + `vi.hoisted` 状态桶 + 假 `tx.{model}.{method}`,在内存里跑完整事务,不依赖真实 DB,跑得快(< 100ms / 组)
- **API 集成测试**:`tests/api/*.test.ts` 走真实 PG,带 `TAG` 前缀 + 自清理
- **vitest 配置**:`environment: "node"`、`include: ["tests/**/*.test.ts"]`、`exclude: ["tests/e2e/**"]`

### 5.2 PR5 测试范围

| 新测试文件 | 覆盖抽象 | 覆盖债务 | 用例数估 |
|---|---|---|---|
| `tests/unit/lib/status-machine.test.ts` | `runTransition` / `runTransitionInTx` | #2 / #9 | ~18 |
| `tests/unit/lib/soft-delete.test.ts` | `softDelete` | #8 | ~8 |
| `tests/unit/lib/money.test.ts` | `calcTaxBreakdown` / `isOverAmount` / `MONEY_TOLERANCE` | #4 / #5 | ~10 |

**`status-machine.test.ts` 18 例分组**
- 事务与重试(4):状态匹配 DONE / 不匹配 silentSkip / 不匹配 ENTITY_IMMUTABLE / loadInTx null → NOT_FOUND
- precondition(3):抛 ApiError 透传 / 抛非 ApiError 透传 / 通过
- P2034 重试(2):1 次失败后成功 / 3 次都失败
- dispatch(2):reviewLog 写 `tx.contractReviewLog.create` / event receivers 为空
- audit 字段(2):before/after 透传 / actorId 支持 `SYSTEM_USER_ID`
- 实体路由(2):entity=Invoice 调 `tx.invoice.update` / entity=Payment 调 `tx.payment.update`
- 集成(3):嵌在外层事务不嵌套 / 单独事务 Serializable+10s / caller 自己包事务不嵌套

**`soft-delete.test.ts` 8 例**
- 子数据空 → DONE;非空 → ENTITY_IMMUTABLE;记录不存在 → NOT_FOUND
- 隔离过滤(ownershipWhere)生效
- 软删后 audit 写 `action: "*_SOFT_DELETE"` / `after: { deleted: true }`
- P2034 重试 3 次后成功;3 次都失败
- transaction timeout 10s

**`money.test.ts` 10 例**
- `calcTaxBreakdown`(6):整数 1000/0.06 / 浮点 0.1+0.2 / 三种入参(number/string/Decimal)/ 0% 税率 / 100% 税率 / `toDecimalPlaces(2)` 舍入
- `isOverAmount`(4):sum+add=cap / sum+add=cap+0.005 / sum+add=cap+0.02 / 默认容差
- `MONEY_TOLERANCE`(1):是 `Prisma.Decimal("0.01")` 实例

### 5.3 与现有测试的回归保证

- `customer-status.test.ts` 现有 8 例继续过(测的是 `changeCustomerStatus` 服务层,抽象切换后行为应保持一致)
- `contract-billing.test.ts` 现有 9 例继续过(测的是 `getBillingStatus`,不动内部)
- `customer-list-filters.test.ts` 等 service 单测全部继续过(PR3 拆分后 import 路径变化,行为不变)
- 20 个 API 集成测试 0 回归

### 5.4 验收

PR5 合完时:
- `npx vitest run` 全绿
- 36 个新单测 + 142 个旧单测 = 178 用例全绿(含 PR1-4 期间任何新增,合计估 200+)
- `npx tsc --noEmit` 0 错

## 6. 风险与缓解

### R1 行为漂移 — 状态机抽象可能微妙改变契约状态变迁
- **来源**:PR1 抽 `runTransitionInTx` 时,如果 caller 给的 `loadInTx` 闭包查询的 `select` 字段不全、`precondition` 顺序变了、或 `silentSkip` 默认值不对
- **缓解**:(1) PR1 落地后跑 142 个现有用例 + 新增 18 个抽象测试;(2) PR1 不删旧函数,先并存跑 1 个 release 周期再删;(3) `customer.ts:changeCustomerStatus` 暂时并存
- **回滚**:单 PR revert

### R2 浮点漂移 — `calcTotals` 从 `Math.round` 切到 `Prisma.Decimal` 可能产生 0.01 级差异
- **来源**:同一笔金额(`1000 * 0.06 / 1.06`)在新旧实现下可能差 0.005 元
- **缓解**:(1) **存量 4668 条合同不动**,只影响 PR1 后新写入的合同;(2) PR2 合前对典型金额在两套实现下分别计算,产出 diff 表;(3) R-07 判定走 `Decimal`,不依赖 `Number(c.totalAmount)`
- **回滚**:若发现新写入的 `taxAmount` 在某区间下系统性偏差(> 0.005),把 contract.ts 改回 `Math.round` 路径,PR2 拆成两个 commit 即可

### R3 容差语义 — `MONEY_TOLERANCE` 由 number 变 Decimal 后比较语义
- **来源**:统一到 `MONEY_TOLERANCE` 后,所有比较走 Decimal,理论上等价,但要在 0.005 / 0.014999 边界上跑通
- **缓解**:(1) `money.test.ts` 锁住 4 条边界;(2) PR2 合前在 dev DB 跑 R-08/R-11/R-12 边界数据
- **回滚**:单 PR revert

### R4 附件冲突检测 — 统一后 conflict 规则稍有变化
- **来源**:现状 contract 路径只查 `a.invoiceId`,invoice 路径只查 `a.contractId`;统一函数需同时查两个字段
- **缓解**:(1) 抽函数前列冲突矩阵:bind=Contract × 4 类附件状态(无 / 已绑本 contract / 已绑它 contract / 已绑 invoice);(2) 4 个边界用例锁住;(3) `tests/api/contract-attachment-snapshot.test.ts` 跑过再合
- **回滚**:单 PR revert

### R5 service 拆分后 import 路径断
- **来源**:PR3 把 `server/services/contract.ts` 拆 5 个子文件
- **缓解**:**保留 barrel** — `server/services/contract/index.ts` re-export 旧名,所有 caller 路径不变
- **回滚**:不需要回滚;barrel 模式下拆分是纯重构

### R6 软删隔离升级 — customer / invoice 软删从无 Serializable 升为有
- **来源**:现状 `softDeleteContract` 用 Serializable + 重试,`softDeleteCustomer` 不用;PR4 统一
- **缓解**:(1) PR4 的 `softDelete` 库内已写 P2034 重试 3 次,自动吞;(2) 5 个现有 `tests/api/soft-delete*` 跑过
- **回滚**:单 PR revert

### R7 KNOWN_KEYS 自动推导可能漏字段
- **来源**:改自动推导后,如果哪个 zod schema 的字段被 `optional()` 包裹但 `deriveKnownKeys` 没识别,会漏
- **缓解**:(1) `deriveKnownKeys` 走 `z.object.shape` 反射,与 optional / default / refine 无关;(2) `use-list-request.test.ts` 改断言 14 个 key 仍然在集合里;(3) PR6 合前对 5 个 listQuery schema 跑 `Object.keys(schema.shape)`,与手维护集合 diff 为空
- **回滚**:单 PR revert

### R8 runTransitionInTx 与外层事务误嵌套
- **来源**:同一段代码既在 caller 自己的 `prisma.$transaction` 里,又调 `runTransition` 单独开事务(Prisma 7 不支持嵌套事务)
- **缓解**:(1) `status-machine.test.ts` 锁住两条路径(已写);(2) JSDoc 在 `runTransitionInTx` 头部明确"用 caller 的 tx,不要在外层再包 $transaction";(3) PR1 改写时把 4 个 caller 标为 `@transition-mode: in-tx` 或 `@transition-mode: standalone` 注释
- **回滚**:调整后再合,无需 revert

### 全局回滚策略

- 每个 PR 独立可 revert;任意一个 PR 出问题不影响后续
- 实际依赖:PR1 / PR2 / PR4 / PR6 互相独立;PR3 依赖 PR1+PR2+PR4(都稳定后再拆);PR5 依赖 PR1+PR2+PR4(测 3 个新抽象)。若 PR1 / PR2 / PR4 任一被 revert,PR3 暂缓(等依赖稳定),PR5 也暂缓(测的抽象未合)
- 每 PR 收尾必须:tsc 0 错、vitest 全绿(新用例 + 142 旧用例)、build 成功、20 个 API 集成测试 0 回归
- 不发版窗口:无强制冻结;PR 都小,合后即可走 dev → prod 标准流程

## 7. 完成标准(本轮全部 6 个 PR 合完后)

- `npx tsc --noEmit` 0 错
- `npx vitest run` 200+ 用例全绿
- `npx eslint .` 0 warning
- `npm run build` 成功
- 20 个 API 集成测试 0 回归
- 5 个 service 文件目录全部细分(contract.ts 928 → contract/ 4-5 子文件 + barrel,最大 < 350 行;customer.ts 508 → customer/ 4 子文件 + barrel,最大 < 200;invoice.ts 455 → invoice/ 3 子文件 + barrel,最大 < 250;payment.ts / user.ts 暂时保持单文件)
- `Math.round` 浮点比较从 4 处收敛到 0 处,合同 / 发票 / 回款的金额比较全部走 `Prisma.Decimal`
- 状态机 / 软删 / 金额 3 套新抽象有 36 条单测覆盖
- 14 条债务清单中,9 条标"已消除"(`#1` `#2` `#3` `#4` `#5` `#8` `#9` `#13` `#14`),5 条标"下一轮"(`#6` `#7` `#10` `#11` `#12`)
- `git log` 上能看到 6 个独立可合 PR,每 PR 描述对应 1-3 条债务消除

## 8. 下一轮 spec 范围(本轮不动)

| 债务 | 主题 | 估时 |
|---|---|---|
| #6 | route handler 工厂(`runWithRequestContext` + `requireSession` + `err` 包装收口) | 0.5d |
| #7 | PDF route 拆出 `server/services/print.ts`,3 个 pdf 路由统一 | 0.5d |
| #10 | 24+ 裸 fetch 全部走 `lib/use-action-call.ts` | 0.5d |
| #11 | `<ResourceDetailPage>` 壳组件 + `<ResourceSection>` 拆分 2 个 500+ 行详情页 | 1.0d |
| #12 | `useListRequest` 推到 5 个列表页 | 0.25d |

总估 2.75d,留作独立 spec 启动。

## 9. 决策记录(Assumptions)

- **拆分粒度(为什么是 6 PR 而非 14)**:14 条里有强耦合(#2 + #9 都在状态机,合 1 PR; #3 + #4 + #5 都在"金额 / 附件 / 容差"工具层,合 1 PR);按"主题"分 6 PR 后,每 PR < 400 行,review 友好,合并无依赖死锁。
- **为什么不直接拆到 7+ 文件的 14 PR**:14 PR 在 6 周内对一个小团队(reviewer pool 1-2 人)是负担,会拖到季度外;6 PR 在 2 周内能合完,reviewer 每次看一份 < 400 行的 diff,反馈循环短。
- **为什么先做后端,不做前端**:#2-#9 集中在 service 层,改完 5 个 service 文件(2412 行)中的 ~400 行,认知负担与维护成本下降幅度最大;前端 24+ 裸 fetch 修完后,**API 形态没变**,后端可以独立迭代;反过来,先做前端得假设后端形态稳定,实际 #1(服务拆分)如果现在动,前端得跟着调一次。
- **为什么 Decimal 替换是 forward-only**:存量的 4668 条合同 `taxAmount` / `amountExcludingTax` 已经按 `Math.round` 写入,PR2 不会回写历史;新合同从 PR1 合后开始走 Decimal,与发票侧行为一致;R-07 判定走 Decimal 后,即使历史的 `taxAmount` 浮点漂移 0.005,R-07 也按 Decimal 比对不受影响。
- **`known-keys` 用 `z.object.shape` 反射而非手维护**:zod 4 之后 `z.object({...}).shape` 直接返回字段 map,无需任何反射库;新加 `optional()` / `default()` 不会改变 shape;只有 `z.union` / `z.discriminatedUnion` 这种复杂 schema 需要 caller 显式写 `*ListQuerySchema`,但 5 个 service 都不存在。
- **softDelete 升级 Serializable 是单向的**:从"无 Serializable"升到"有 Serializable + 重试"在功能上是超集(多了一层保护);从"有 Serializable"降回"无"才是危险的,本轮不可逆。

## 10. 实施前必须确认

- [ ] PR1 准备合前,跑 `npx tsc --noEmit` + `npx vitest run` + 20 个 API 集成测试全绿
- [ ] PR2 准备合前,典型金额(100/1000/1234.56/99999.99)在新旧 `calcTaxBreakdown` 下的 diff 表贴在 PR 描述
- [ ] PR3 准备合前,`tsc --noEmit` 通过 + `barrel` 路径兼容(grep 旧 import 路径全部命中)
- [ ] PR4 准备合前,5 个 `tests/api/soft-delete*` 通过
- [ ] PR5 准备合前,36 个新单测全绿 + 142 个旧单测 0 回归
- [ ] PR6 准备合前,`Object.keys(schema.shape)` 与原 `KNOWN_KEYS` 集合 diff 为空

---

> 审阅通过后,本文档归档到 `docs/superpowers/specs/2026-06-24-qt-biz-service-refactor-design.md`,接着用 writing-plans 技能拆 6 个 PR 实施计划。
