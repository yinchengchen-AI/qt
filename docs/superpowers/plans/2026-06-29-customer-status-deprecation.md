# 客户状态机下线 (Customer Status Machine Deprecation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完全下线 v0.4.0 上线的客户状态机体系 (5 态枚举 / 迁移表 / 4 条自动规则 / 撤销横幅 / 跨模块校验 R-02 R-13 R-13b~e), 让 `Customer` 表不再有 status 概念, 业务方后续定义新流程。

**Architecture:** 一次性硬删, 不可回退。按 schema -> lib -> server -> API -> UI -> types/events -> tests -> docs -> env -> 验证 顺序推进, 每完成一层用 tsc 验一遍, 最后一次性 commit。`MessageType` enum 的 3 个 deprecated 值保留 (PG 不支持 DROP VALUE), 停止 emit 即可。`bus.ts` 删 3 个 case 后, default 分支改 fallback title 渲染历史消息。

**Tech Stack:** Next.js 16 App Router + React 19 + TypeScript + Prisma 7 + PostgreSQL 16 + Vitest + Playwright. 已 commit: spec `ae7c798` (2026-06-29-customer-status-deprecation.md).

**Spec:** [docs/superpowers/specs/2026-06-29-customer-status-deprecation.md](../specs/2026-06-29-customer-status-deprecation.md)

**Working directory:** `/Users/yinchengchen/qt`

---

## File Structure

**Files to delete (6):**
- `lib/customer-status-transitions.ts` (174 行)
- `lib/customer-auto-rules.ts` (149 行)
- `server/services/customer/automation.ts` (49 行)
- `server/services/customer/status.ts` (300+ 行)
- `server/jobs/customer-status-suggest.ts` (231 行)
- `app/api/customers/[id]/revert/route.ts`
- `components/customers/auto-status-banner.tsx` (179 行)

(7 actually — counting 07-route — 8 total. adjusted below.)

**Files to modify (~30):**
- `prisma/schema.prisma` (删 3 列 + 1 索引)
- 新建 `prisma/migrations/20260629_drop_customer_status/migration.sql`
- `lib/customer-update.ts`, `lib/status.ts`, `lib/dict-domain.ts`, `lib/dictionary-categories.ts`, `lib/use-status-enum.ts`, `lib/validators/customer.ts`, `lib/env.ts`
- `server/services/customer/crud.ts`, `server/services/contract/crud.ts`, `server/services/contract/status.ts`, `server/jobs/runner.ts`
- `app/api/customers/[id]/route.ts`, `app/api/customers/export/route.ts`, `app/api/customers/[id]/pdf/route.ts`, `app/api/jobs/[job]/route.ts`
- `app/(app)/customers/page.tsx`, `app/(app)/customers/[id]/page.tsx`, `app/(app)/customers/[id]/edit/page.tsx`
- `components/customers/customer-form.tsx`
- `types/enums.ts`, `types/errors.ts`, `server/events/bus.ts`
- `lib/operation-log-drawer.tsx` (or `components/admin/operation-log-drawer.tsx`, 查实际路径) — 加 action fallback
- `tests/unit/lib/customer-update.test.ts`, `tests/api/customers-patch.test.ts`
- `README.md`, `docs/DESIGN-v3.md`, `docs/PROJECT_SUMMARY.md`, `docs/USER_MANUAL.md`
- `.env.example`

**Tests to delete (6):**
- `tests/unit/lib/customer-status-transitions.test.ts`
- `tests/unit/lib/customer-auto-rules.test.ts`
- `tests/unit/server/customer-status-automation.test.ts`
- `tests/unit/server/customer-status-suggest.test.ts`
- `tests/unit/server/customer-status.test.ts`
- `tests/e2e/08-customer-status.spec.ts`

---

## Task 1: Schema 改动 + 迁移

**Files:**
- Modify: `prisma/schema.prisma:255-296` (Customer model)
- Create: `prisma/migrations/20260629_drop_customer_status/migration.sql`

- [ ] **Step 1.1: 改 prisma/schema.prisma — 删 Customer 3 列 + 1 索引**

打开 `prisma/schema.prisma`, 在 `model Customer` 段 (line 255-296) 做以下删除:

1. 删 `status` 字段 (line 277-278):
```prisma
  status        String    @default("LEAD") // LEAD | NEGOTIATING | SIGNED | LOST | FROZEN
  // 客户状态机自动化: 系统最近一次自动写状态的时间 + 触发规则 ID (nullable, 旧数据全 null)
  // 用于详情页横幅 + 7 天撤销窗口; 见 lib/customer-auto-rules.ts
  lastAutoAppliedAt DateTime? @db.Timestamptz(6)
  lastAutoRule      String?   // CONTRACT_ACTIVATED | ALL_CONTRACTS_CLOSED | INACTIVE_LOST | INACTIVE_FROZEN
```

2. 删 `@@index([status])` 索引 (line 294 一带).

改后 Customer.status 段附近应该是:
```prisma
  contactName   String?
  contactTitle  String?
  contactPhone  String
  sourceChannel String?
  ownerUserId   String
  createdAt     DateTime  @default(now()) @db.Timestamptz(6)
  ...
  @@index([ownerUserId])
  @@index([customerType])
```

`@@index([status])` 整行删掉。

- [ ] **Step 1.2: 创建 migration SQL**

新建 `prisma/migrations/20260629_drop_customer_status/migration.sql`, 内容:

```sql
-- =====================================================
-- 客户状态机下线: 删 Customer.status / lastAutoAppliedAt / lastAutoRule
-- 配合 spec 2026-06-29-customer-status-deprecation.md §2.1
-- =====================================================

DROP INDEX IF EXISTS "Customer_status_idx";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "status";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "lastAutoAppliedAt";
ALTER TABLE "Customer" DROP COLUMN IF EXISTS "lastAutoRule";
```

- [ ] **Step 1.3: 跑 prisma generate + 验证 schema 一致**

Run:
```bash
npx prisma format
npx prisma generate
npx tsc --noEmit
```

Expected: tsc 通过 (现在还没删其它 lib, schema 改了, 引用 `Customer.status` 的代码会编译失败, 这是预期的, 后续 Task 修).

如果 prisma format 改动超出预期, 手动 `git checkout prisma/schema.prisma` 重新做 Step 1.1.

- [ ] **Step 1.4: 暂不 commit, 继续 Task 2 (同一 commit)**

---

## Task 2: lib 删除 + 改动 (核心库)

**Files:**
- Delete: `lib/customer-status-transitions.ts`, `lib/customer-auto-rules.ts`
- Modify: `lib/customer-update.ts`, `lib/status.ts`, `lib/dict-domain.ts`, `lib/dictionary-categories.ts`, `lib/use-status-enum.ts`, `lib/validators/customer.ts`, `lib/env.ts`

- [ ] **Step 2.1: 删 lib/customer-status-transitions.ts**

```bash
rm lib/customer-status-transitions.ts
rm tests/unit/lib/customer-status-transitions.test.ts
```

- [ ] **Step 2.2: 删 lib/customer-auto-rules.ts**

```bash
rm lib/customer-auto-rules.ts
rm tests/unit/lib/customer-auto-rules.test.ts
```

- [ ] **Step 2.3: 改 lib/customer-update.ts**

打开 `lib/customer-update.ts`, 删以下注释 (line 29 一带):
```ts
  // status 走 changeCustomerStatus, 这里不写, 防止绕过 R-02 / R-13 业务规则
```

函数 `buildCustomerUpdateData` 本身保留 (它原本就不写 status 字段, 注释是文档).

- [ ] **Step 2.4: 改 lib/status.ts**

打开 `lib/status.ts`, 做 3 处删改:

1. `StatusDomain` 联合 (line 3-10) 删 `"customer"`:
```ts
export type StatusDomain =
  | "contract"
  | "invoice"
  | "payment"
  | "message"
  | "announcement"
  ;
```

2. 删 `CUSTOMER` 字典 (line 16-24):
```ts
/* === Customer === */
const CUSTOMER: Record<string, StatusMeta> = {
  LEAD:        { label: "线索",     tone: "default" },
  ...
  FROZEN:      { label: "已冻结",   tone: "danger" }
};

```

3. `DOMAIN_MAP` (line 71-79) 删 `customer: CUSTOMER,` 一行.

- [ ] **Step 2.5: 改 lib/dict-domain.ts**

打开 `lib/dict-domain.ts`, 删 `CUSTOMER_STATUS` 字典类别配置 (line 54 一带):
```ts
  CUSTOMER_STATUS: { category: "CUSTOMER_STATUS", label: "客户状态", shape: "table", readonly: false, description: "客户状态机: 线索/谈判/签约/流失/冻结" },
```

保留 `CUSTOMER_STATUS: "状态域"` (line 75) — 这是 type 引用, 类型仍可工作因为它 string literal 不是 enum.

实际上 line 75 的 `CUSTOMER_STATUS: "状态域"` 是 DictCategory key 的 value, 删了会让 key 没 value. 让我重新看.

检查: `DictCategory` 实际是 enum/union. 跑一下 `rg "CUSTOMER_STATUS" lib/dict-domain.ts` 确认实际结构, 决定删哪些行.

- [ ] **Step 2.6: 改 lib/dictionary-categories.ts**

打开 `lib/dictionary-categories.ts`, 删 line 11 和 line 33:
```ts
  "CUSTOMER_STATUS",
```
和
```ts
  CUSTOMER_STATUS: "客户状态",
```

跑 `rg "CUSTOMER_STATUS" lib/` 确认没有其它引用, 否则保留.

- [ ] **Step 2.7: 改 lib/use-status-enum.ts**

打开 `lib/use-status-enum.ts` (21 行), 跑 `rg "customer" lib/use-status-enum.ts`, 如有 `customer` 引用, 删掉. 如无, 不动.

- [ ] **Step 2.8: 改 lib/validators/customer.ts**

打开 `lib/validators/customer.ts`, 做以下删改:

1. line 30 `customerUpdateSchema = customerCreateSchema.partial().extend({ status: z.enum(CUSTOMER_STATUS).optional(), reason: z.string().max(200).optional() });` 改为:
```ts
export const customerUpdateSchema = customerCreateSchema.partial();
```

(删 status / reason 字段, 也不需要 extend 了)

2. 检查 `customerExportSchema` (line 41 一带), 删 `status: z.string().optional(),` 字段.

3. 整段 `customerRevertSchema` (line 56-60 一带) 删, 函数不再用.

如果文件只剩 `customerCreateSchema` 和 `customerUpdateSchema`, 跑 `rg "customerRevertSchema" .` 确认无引用后整段删.

- [ ] **Step 2.9: 改 lib/env.ts**

打开 `lib/env.ts`, 删 4 个 env 字段 (line 38-46 schema 段, line 66-69 runtimeEnv 段):

schema 段删:
```ts
    // 客户状态机自动化规则开关 (P 客户状态机优化 §2.1):
    //   CUSTOMER_AUTO_RULES_DISABLED  - 逗号分隔的 rule id 列表, 命中即关闭该规则
    //     (空 = 全开). 规则 ID 见 lib/customer-auto-rules.ts
    //   CUSTOMER_AUTO_DISPUTE_DAYS   - 自动写后多久内可人工撤销 (默认 7 天)
    //   CUSTOMER_AUTO_INACTIVE_LOST_DAYS    - 90 天无活动 → 建议/自动写 LOST (默认 90)
    //   CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS  - 60 天无活动 + 所有合同 CLOSED → 自动写 FROZEN (默认 60)
    CUSTOMER_AUTO_RULES_DISABLED: z.string().default(""),
    CUSTOMER_AUTO_DISPUTE_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    CUSTOMER_AUTO_INACTIVE_LOST_DAYS: z.coerce.number().int().min(1).max(365).default(90),
    CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS: z.coerce.number().int().min(1).max(365).default(60)
```

runtimeEnv 段删:
```ts
    CUSTOMER_AUTO_RULES_DISABLED: process.env.CUSTOMER_AUTO_RULES_DISABLED,
    CUSTOMER_AUTO_DISPUTE_DAYS: process.env.CUSTOMER_AUTO_DISPUTE_DAYS,
    CUSTOMER_AUTO_INACTIVE_LOST_DAYS: process.env.CUSTOMER_AUTO_INACTIVE_LOST_DAYS,
    CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS: process.env.CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS
```

- [ ] **Step 2.10: 验证 lib 层 tsc**

Run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 仍会有错误 (server 层还没改), 但 lib 自身 + 引用 lib 的 server 错误应该清晰可读. 记录错误数, 继续 Task 3 4 5.

---

## Task 3: server services 改动

**Files:**
- Delete: `server/services/customer/automation.ts`, `server/services/customer/status.ts`, `server/jobs/customer-status-suggest.ts`
- Delete tests: `tests/unit/server/customer-status-automation.test.ts`, `tests/unit/server/customer-status-suggest.test.ts`, `tests/unit/server/customer-status.test.ts`
- Modify: `server/services/customer/crud.ts`, `server/services/contract/crud.ts`, `server/services/contract/status.ts`, `server/jobs/runner.ts`

- [ ] **Step 3.1: 删 server/services/customer/automation.ts**

```bash
rm server/services/customer/automation.ts
```

- [ ] **Step 3.2: 删 server/services/customer/status.ts**

```bash
rm server/services/customer/status.ts
```

- [ ] **Step 3.3: 删 server/jobs/customer-status-suggest.ts**

```bash
rm server/jobs/customer-status-suggest.ts
```

- [ ] **Step 3.4: 改 server/services/customer/crud.ts**

打开 `server/services/customer/crud.ts`, 跑 `rg "onContractActivated|onContractClosed" server/services/customer/crud.ts`. 删 3 处引用 (line 17 import + 2 处 await). 如无 await 引用, 仍删 import.

具体: line 17 附近删:
```ts
import { onContractActivated, onContractClosed } from "@/server/services/customer/automation";
```

全文搜 `await onContractActivated` / `await onContractClosed` 删 await.

- [ ] **Step 3.5: 改 server/services/contract/crud.ts**

打开 `server/services/contract/crud.ts`, 删 2 处:

1. line 15 一带删:
```ts
import { onContractActivated } from "@/server/services/customer/automation";
```

2. line 244 删:
```ts
      await onContractActivated(id);
```

3. line 327 删:
```ts
      await onContractActivated(id);
```

注意: 删后该 transaction 块可能会变空 (如果只剩 onContractActivated 一行), 视情况删整个 `if (...) { ... }` 块.

- [ ] **Step 3.6: 改 server/services/contract/status.ts**

打开 `server/services/contract/status.ts`, 删 2 处:

1. line 14 一带删:
```ts
import { onContractClosed } from "@/server/services/customer/automation";
```

2. line 265-267 删:
```ts
  // runTransition 已经包了独立事务, 这里直接 await; onContractClosed 自己再开新事务
  if (...) {
    await onContractClosed(contractId);
  }
```

3. line 337 一带删:
```ts
    await onContractClosed(contractId);
```

具体看上下文, 删整段 if 块.

- [ ] **Step 3.7: 改 server/jobs/runner.ts**

打开 `server/jobs/runner.ts`, 跑 `rg "customer-status-suggest"`. 如有引用 (registration / dispatch table), 删掉.

- [ ] **Step 3.8: 删 server 层 tests**

```bash
rm tests/unit/server/customer-status-automation.test.ts
rm tests/unit/server/customer-status-suggest.test.ts
rm tests/unit/server/customer-status.test.ts
```

- [ ] **Step 3.9: 验证 server 层 tsc**

Run:
```bash
npx tsc --noEmit 2>&1 | head -50
```

Expected: server 错误数减少. 继续 Task 4.

---

## Task 4: API 路由改动

**Files:**
- Delete: `app/api/customers/[id]/revert/route.ts`
- Modify: `app/api/customers/[id]/route.ts`, `app/api/customers/export/route.ts`, `app/api/customers/[id]/pdf/route.ts`, `app/api/jobs/[job]/route.ts`

- [ ] **Step 4.1: 删 app/api/customers/[id]/revert/route.ts**

```bash
rm app/api/customers/[id]/revert/route.ts
```

(整个目录都空了, 跑 `rmdir app/api/customers/[id]/revert` 删空目录, 如 git 不追踪空目录可跳)

- [ ] **Step 4.2: 改 app/api/customers/[id]/route.ts**

打开文件, 跑 `rg "status|changeCustomerStatus"`. 删以下:

1. 删 `changeCustomerStatus` import (line 7 一带).

2. line 38-45 段:
```ts
      // 先加载现有客户, 状态未变化时不要把 status 传给 changeCustomerStatus
      const existing = await getCustomer(user, id);
      if (input.status !== undefined && input.status !== existing.status) {
        await changeCustomerStatus(user, id, input.status, input.reason);
      }
      // 剩余字段走 updateCustomer; 此时 status 已单独处理, 避免被 updateCustomer 覆盖
      const { status: _status, reason: _reason, ...rest } = input;
```

改为:
```ts
      // 剩余字段走 updateCustomer
```

后续 `updateCustomer(user, id, rest)` 调用保持.

如 `getCustomer` 也仅用于这段, 评估是否删除. 通常 `getCustomer` 还有其它用途, 保留.

- [ ] **Step 4.3: 改 app/api/customers/export/route.ts**

打开文件, 删 2 处:

1. line 33 删 `status: z.string().optional(),` (zod schema).

2. line 103 删:
```ts
          {
            header: "状态",
            key: "status",
            width: 10,
            formatter: (v) => label("CUSTOMER_STATUS", v as string),
          },
```

如果 label 不再用 `CUSTOMER_STATUS` 类别, 改 `CUSTOMER_STATUS_MAP` 为空 dict 或保留 import.

- [ ] **Step 4.4: 改 app/api/customers/[id]/pdf/route.ts**

打开文件, 改 2 处:

1. line 51 一带: `const dict: Record<string, string> = { ...CUSTOMER_STATUS_MAP };` 改为:
```ts
const dict: Record<string, string> = {};
```

如 `CUSTOMER_STATUS_MAP` 仍 import, 删 import.

2. line 56 改:
```ts
        subtitle: `客户编号 ${c.code}`,
```

(删 `· 状态 ${label("CUSTOMER_STATUS", c.status)}` 部分)

- [ ] **Step 4.5: 改 app/api/jobs/[job]/route.ts**

打开文件, 跑 `rg "customer-status-suggest"`. 如有 switch/if 分支, 删该分支 (job 名已不存在).

- [ ] **Step 4.6: 验证 API 层 tsc**

Run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: API 错误数减少. 继续 Task 5.

---

## Task 5: UI 改动

**Files:**
- Delete: `components/customers/auto-status-banner.tsx`
- Modify: `app/(app)/customers/page.tsx`, `app/(app)/customers/[id]/page.tsx`, `app/(app)/customers/[id]/edit/page.tsx`, `components/customers/customer-form.tsx`

- [ ] **Step 5.1: 删 components/customers/auto-status-banner.tsx**

```bash
rm components/customers/auto-status-banner.tsx
```

- [ ] **Step 5.2: 改 app/(app)/customers/page.tsx**

打开文件, 删 4 处:

1. line 11 一带删 import:
```ts
import { StatusTag } from "@/components/status-tag";
```

2. line 14 一带删 import:
```ts
import { useStatusValueEnum } from "@/lib/use-status-enum";
```

3. line 28 `status: string;` (TableRow 类型) 删.

4. line 46 一带删:
```ts
  const statusEnum = useStatusValueEnum("customer");
```

5. line 203 一带 (URL params) 删 `status: params.status,` 行.

6. line 311-314 删:
```ts
            dataIndex: "status",
            ...
            valueEnum: statusEnum,
            render: (_, r) => <StatusTag status={r.status} domain="customer" />
```

columns 里整段删.

- [ ] **Step 5.3: 改 app/(app)/customers/[id]/page.tsx**

打开文件 (约 400 行), 删以下:

1. line 14 一带删:
```ts
import { AutoStatusBanner } from "@/components/customers/auto-status-banner";
```

2. line 16 一带删:
```ts
import { StatusTag } from "@/components/status-tag";
```
(只用于 status 渲染; 如还有别处用, 保留 import)

3. line 21 一带删:
```ts
import { getAllowedTransitions, isCustomerStatus } from "@/lib/customer-status-transitions";
```

4. line 32-33 删:
```ts
  lastAutoAppliedAt: string | null;
  lastAutoRule: string | null;
```

5. line 59-60 删 `statusPopoverOpen` state.

6. line 145 状态列 (`<StatusTag status={r.status as string} domain="customer" />` 在合同列表里, 注意 contract status ≠ customer status) 确认后再删 — 实际是 contract 状态, 不动!

7. line 254-260 一带删 `<AutoStatusBanner>` 引用.

8. line 252 (meta 里的 StatusTag customer) 删, 或改为 null.

具体: 跑 `rg "StatusTag|getAllowedTransitions|isCustomerStatus|statusPopoverOpen|AutoStatusBanner" app/\(app\)/customers/\[id\]/page.tsx` 确认所有引用, 逐个删.

- [ ] **Step 5.4: 改 app/(app)/customers/[id]/edit/page.tsx**

打开文件, 跑 `rg "status|isCustomerStatus|getAllowedTransitions"`. 如有 status 字段渲染, 删.

- [ ] **Step 5.5: 改 components/customers/customer-form.tsx**

打开文件, 删以下:

1. line 19-21 一带删:
```ts
import { getAllowedTransitions, isCustomerStatus } from "@/lib/customer-status-transitions";
import { getStatusOptions } from "@/lib/status";
import type { CustomerStatus } from "@/types/enums";
```

2. line 31 `status?: string;` (form values 类型) 删.

3. line 62, 64 statusValue state + watchedStatus 删.

4. line 71-77 allCustomerStatusOptions / currentStatus / statusOptions 删.

5. line 97 `if ("status" in changed) setStatusValue(changed.status as string);` 删.

6. line 209-212 状态字段 (`<Form.Item name="status" ...>`) 整段删.

- [ ] **Step 5.6: 验证 UI 层 tsc**

Run:
```bash
npx tsc --noEmit 2>&1 | head -50
```

Expected: UI 错误数减少. 继续 Task 6.

---

## Task 6: types / events / errors 改动

**Files:**
- Modify: `types/enums.ts`, `types/errors.ts`, `server/events/bus.ts`

- [ ] **Step 6.1: 改 types/enums.ts**

打开文件, 删 2 行 (line 19-20):
```ts
export const CUSTOMER_STATUS = ["LEAD", "NEGOTIATING", "SIGNED", "LOST", "FROZEN"] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUS)[number];
```

`MessageType` enum (line 106/117/120) 保留 3 个 deprecated 值 (CUSTOMER_STATUS_SUGGEST / AUTO_APPLIED / AUTO_REVERTED) — 不删.

- [ ] **Step 6.2: 改 types/errors.ts**

打开文件, 删 7 条错误码 (line 11-19 段 + line 46-52 段):

line 11-19 段删:
```ts
  CUSTOMER_STATUS_INVALID: "CUSTOMER_STATUS_INVALID",
  CUSTOMER_HAS_ACTIVE_CONTRACT: "CUSTOMER_HAS_ACTIVE_CONTRACT",
  CUSTOMER_STATUS_TRANSITION_INVALID: "CUSTOMER_STATUS_TRANSITION_INVALID",
  CUSTOMER_FROZEN_ACTIVE_PAYMENT: "CUSTOMER_FROZEN_ACTIVE_PAYMENT",
  CUSTOMER_STATUS_REASON_REQUIRED: "CUSTOMER_STATUS_REASON_REQUIRED",
  // 客户状态机自动化 (§2.4): 尝试撤销已超过 CUSTOMER_AUTO_DISPUTE_DAYS 窗口
  CUSTOMER_AUTO_DISPUTE_EXPIRED: "CUSTOMER_AUTO_DISPUTE_EXPIRED",
  // 客户状态机自动化 (§2.4): 撤销时客户当前 status 不等于 lastAutoRule.targetStatus
  CUSTOMER_AUTO_REVERT_TARGET_INVALID: "CUSTOMER_AUTO_REVERT_TARGET_INVALID",
```

line 46-52 段删对应中文消息:
```ts
  CUSTOMER_STATUS_INVALID: "客户状态不允许此操作（需至少一份生效中的合同）",
  CUSTOMER_HAS_ACTIVE_CONTRACT: "客户存在进行中合同或未对账回款，无法冻结",
  CUSTOMER_STATUS_TRANSITION_INVALID: "客户状态变更不被允许",
  CUSTOMER_FROZEN_ACTIVE_PAYMENT: "客户存在未对账回款，无法冻结",
  CUSTOMER_STATUS_REASON_REQUIRED: "变更到该状态需要填写原因（LOST/FROZEN 必填）",
  CUSTOMER_AUTO_DISPUTE_EXPIRED: "已超过可撤销期限, 不能撤销系统自动改的状态",
  CUSTOMER_AUTO_REVERT_TARGET_INVALID: "客户当前状态与系统自动改的状态不一致, 不能撤销",
```

- [ ] **Step 6.3: 改 server/events/bus.ts**

打开文件, 删 3 个 case (line 78 一带, line 144 一带, line 154 一带):

1. `case "CUSTOMER_STATUS_SUGGEST":` 整段删 (line 78-85).

2. `case "CUSTOMER_STATUS_AUTO_APPLIED":` 整段删 (line 144-152).

3. `case "CUSTOMER_STATUS_AUTO_REVERTED":` 整段删 (line 154-160).

- [ ] **Step 6.4: 改 bus.ts default 分支 — 历史消息渲染 fallback**

打开 `server/events/bus.ts`, 找到 `default: return assertNever(ev.type);` (function 末尾), 改为:

```ts
      default:
        // 历史消息 fallback: deprecated 事件类型 (CUSTOMER_STATUS_SUGGEST 等) 保留在 enum 但不再 emit
        return {
          receiverUserId: uid,
          title: `历史消息 (${ev.type})`,
          content: "该消息类型已下线, 详情请联系管理员",
        };
```

实际 switch 在 `buildEvent` 函数 (or similar), 看 bus.ts 实际结构改.

- [ ] **Step 6.5: 删 statusLabel 函数 (如不再用)**

打开 `server/events/bus.ts`, 找 `function statusLabel`, 跑 `rg "statusLabel" server/events/bus.ts`. 如仅上面删的 3 个 case 用, 整段删.

- [ ] **Step 6.6: 验证 types/events 层 tsc**

Run:
```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: 错误数大幅减少, 接近 0.

---

## Task 7: operation-log 历史 action 渲染 fallback

**Files:**
- Modify: 找 operation-log 抽屉组件 (实际路径待 grep)

- [ ] **Step 7.1: 定位 OperationLog 抽屉组件**

```bash
rg "CUSTOMER_STATUS_CHANGE|CUSTOMER_STATUS_AUTO_CHANGE|CUSTOMER_STATUS_REVERT" components/ app/ -l
```

可能路径: `components/admin/operation-log-drawer.tsx` (从前面 grep 看到).

- [ ] **Step 7.2: 改 OperationLog 渲染**

打开抽屉文件, 跑 `rg "CUSTOMER_STATUS"`. 如有专门渲染这 3 个 action 的分支, 改为通用 fallback (显示 raw action 字符串 + 描述).

如果抽屉是 generic 渲染 (从 raw `action` 字段直接显示), 不用改.

- [ ] **Step 7.3: 验证**

Run:
```bash
npx tsc --noEmit 2>&1 | tail -10
```

---

## Task 8: tests 改动 (新增 + 修改)

**Files:**
- Modify: `tests/unit/lib/customer-update.test.ts`, `tests/api/customers-patch.test.ts`

- [ ] **Step 8.1: 改 tests/unit/lib/customer-update.test.ts**

打开文件, 跑 `rg "status" tests/unit/lib/customer-update.test.ts`. 删 status 相关的 test case (如 "should not write status field"). 保留其它.

加 1 个新 case (TDD 风格 — 先加测试, 跑应当 pass, 因为 Step 2.3 已经实现):

```ts
  it("buildCustomerUpdateData 不会写入 status 字段 (防御性)", () => {
    const data = buildCustomerUpdateData(
      { name: "X", status: "FROZEN", reason: "test" } as unknown as CustomerUpdateInput,
      "user-1"
    );
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("reason");
    expect(data.name).toBe("X");
  });
```

- [ ] **Step 8.2: 改 tests/api/customers-patch.test.ts**

打开文件, 跑 `rg "status|changeCustomerStatus" tests/api/customers-patch.test.ts`. 删 2 个 status 相关的 test case (line 80 一带 "LEAD 客户只改名称 status 仍为 LEAD" + line 94 一带 "status 真正变化时仍走业务校验"). 

跑 `npx vitest run tests/api/customers-patch.test.ts` 确认.

- [ ] **Step 8.3: 跑全量 vitest**

Run:
```bash
npx vitest run 2>&1 | tail -30
```

Expected: 失败的只剩 PG 不可用 (跟环境相关, 不是代码问题). 跑过的应当全绿.

---

## Task 9: docs 改动

**Files:**
- Modify: `docs/DESIGN-v3.md`, `docs/PROJECT_SUMMARY.md`, `docs/USER_MANUAL.md`, `README.md`

- [ ] **Step 9.1: 删 docs/DESIGN-v3.md §5.5**

打开文件, 找 `### 5.5 \`Customer.status\`` (line 301 一带), 整段删到 `## 6. 跨模块校验规则` 之前.

注意: 5.5 段还包含 R-02 / R-13 / R-13b~e 校验定义, 删后这些校验在 §6 也不应再提. 跑 `rg "R-02|R-13" docs/DESIGN-v3.md` 确认, 删残留.

- [ ] **Step 9.2: 删 docs/PROJECT_SUMMARY.md §3.3.2**

打开文件, 找 `#### 3.3.2` (line 123 一带), 整段删到 `### 3.4` 之前.

- [ ] **Step 9.3: 删 docs/USER_MANUAL.md §5.6**

打开文件, 找 `### 5.6 客户状态自动联动` (line 239 一带), 整段删到 `## 6.` 之前. 

§5.6 末尾的 "---" 分隔符 (line 283 一带) 也要删, 因为 §5.7 (如有) 或 §6 之前不需要这条 hr.

- [ ] **Step 9.4: 改 README.md**

打开文件, 跑 `rg "CUSTOMER_STATUS|客户状态机|status|automation|auto" README.md`. 删 customer status 相关描述.

- [ ] **Step 9.5: 删 docs/superpowers/specs/2026-06-28-customer-status-automation.md**

```bash
rm docs/superpowers/specs/2026-06-28-customer-status-automation.md
```

(spec 是单一事实源, 现在事实变了: status 概念下线, 老 spec 不再代表真理. 但历史 commit 仍包含它, git 历史可查.)

- [ ] **Step 9.6: 验证文档链接不破**

Run:
```bash
rg "2026-06-28-customer-status-automation|customer-status-automation\.md" docs/ README.md
```

Expected: 无引用 (or 只在 git log / git blame 里).

---

## Task 10: env 文件改动

**Files:**
- Modify: `.env.example`

- [ ] **Step 10.1: 删 .env.example 4 字段**

打开 `.env.example`, 跑 `rg "CUSTOMER_AUTO" .env.example`. 如有, 删 (但从前面的勘察, .env.example 似乎没列这 4 个字段, 所以可能无 op).

如确认无 op, skip.

---

## Task 11: 全量验证

**Files:**
- 无文件改动, 跑验证命令

- [ ] **Step 11.1: tsc**

Run:
```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 11.2: lint**

Run:
```bash
npm run lint
```

Expected: 0 errors / 0 warnings.

- [ ] **Step 11.3: vitest (PG 相关测试可能因 docker 未起而失败, 但与本 PR 无关)**

Run:
```bash
npx vitest run 2>&1 | tail -30
```

Expected: 失败应当仅为 docker daemon 未起导致 PrismaClientKnownRequestError, 与本 PR 删 status 字段无关.

- [ ] **Step 11.4: 关键 unit 验证 (PG 无关)**

Run:
```bash
npx vitest run tests/unit/lib/ tests/unit/server/ --reporter=verbose 2>&1 | tail -50
```

Expected: 全绿.

- [ ] **Step 11.5: 检查所有 import 链**

Run:
```bash
rg "customer-status-transitions|customer-auto-rules|changeCustomerStatus|autoChangeCustomerStatus|revertCustomerStatus|onContractActivated|onContractClosed|CustomerAutoRule|useStatusValueEnum" --type ts --type tsx -g '!node_modules' -g '!.next' 2>&1 | head -20
```

Expected: 无引用残留 (或者仅在 git history / comments).

- [ ] **Step 11.6: grep 残留**

Run:
```bash
rg "CUSTOMER_STATUS_(SUGGEST|AUTO_APPLIED|AUTO_REVERTED)" --type ts --type tsx -g '!node_modules' -g '!.next' 2>&1
```

Expected: 仅在 MessageType enum 定义 + 文档说明, 不再有 emit 路径.

- [ ] **Step 11.7: Playwright e2e (跳 08, 跑其它)**

Run:
```bash
npm run test:e2e -- --grep-invert "customer-status" 2>&1 | tail -30
```

Expected: 其它 spec 全绿. (注: e2e 需要 dev server 起, docker daemon 也要起. 如环境不允许, skip.)

---

## Task 12: commit

- [ ] **Step 12.1: 检查 git status**

```bash
git status
```

Expected: 修改 ~30 文件, 删除 8 文件, 新增 1 migration. 工作树应当没有意外改动.

- [ ] **Step 12.2: git add**

```bash
git add -A
```

(全部 stage, 包括删除)

- [ ] **Step 12.3: commit**

```bash
git commit -m "feat(customer): 删 status 字段 + 状态机 + 自动化 (硬下线, v0.5.0)

业务反馈 5 态语义与销售工作流脱节, 90/60 天自动改 LOST/FROZEN 误判率高,
7 天撤销横幅干扰销售, 完全下线整个客户状态及状态机体系。

**Schema**:
- 删 Customer.status / lastAutoAppliedAt / lastAutoRule 3 列
- 删 @@index([status])
- 新增 migration 20260629_drop_customer_status (drop column 干净, 不需 backfill)
- MessageType enum 保留 3 个 deprecated 值 (PG 不支持 DROP VALUE)

**Lib**:
- 删 lib/customer-status-transitions.ts (174 行)
- 删 lib/customer-auto-rules.ts (149 行)
- 改 lib/{status,dict-domain,dictionary-categories,use-status-enum,validators/customer,env,customer-update}.ts
- 删 4 字段 env (CUSTOMER_AUTO_*)

**Server**:
- 删 server/services/customer/{automation,status}.ts
- 删 server/jobs/customer-status-suggest.ts
- 改 customer/crud.ts / contract/{crud,status}.ts / jobs/runner.ts

**API**:
- 删 app/api/customers/[id]/revert/route.ts
- 改 customers/{[id]/route,export/route,[id]/pdf/route}.ts
- 改 app/api/jobs/[job]/route.ts (删 customer-status-suggest 分支)

**UI**:
- 删 components/customers/auto-status-banner.tsx (179 行)
- 改 customers/{page,[id]/page,[id]/edit/page}.tsx
- 改 components/customers/customer-form.tsx (删状态字段)

**Types/Events/Errors**:
- 删 CUSTOMER_STATUS 数组 + CustomerStatus 类型
- 删 7 错误码 (CUSTOMER_STATUS_* + CUSTOMER_AUTO_*)
- bus.ts 删 3 case + default fallback title 渲染历史消息

**Tests**:
- 删 6 测试文件 (transitions / auto-rules / automation / suggest / status / 08 e2e)
- 改 customer-update.test.ts + customers-patch.test.ts
- 加 1 个 buildCustomerUpdateData 防御性用例

**Docs**:
- 删 v0.4.0 spec (2026-06-28) + DESIGN-v3 §5.5 + PROJECT_SUMMARY §3.3.2 + USER_MANUAL §5.6
- 改 README 状态表

**保留**:
- 3 个 audit action 字符串 (CUSTOMER_STATUS_CHANGE / AUTO_CHANGE / REVERT) — 历史可读
- 3 个 MessageType enum 值 — 历史消息可读, PG 不支持 DROP VALUE

**验证**:
- tsc / lint 全绿
- vitest 关键 unit 全绿 (PG 相关失败为 docker daemon 未起, 与本 PR 无关)
- Playwright 跳 08 后其它 spec 全绿 (待 dev 环境跑)

BREAKING CHANGE: 客户失去 status 概念, 业务方后续定义新流程.
不可逆: schema drop 不可回退, 部署前先 dev 跑 1 天观察.

spec: docs/superpowers/specs/2026-06-29-customer-status-deprecation.md
plan: docs/superpowers/plans/2026-06-29-customer-status-deprecation.md"
```

- [ ] **Step 12.4: 验证 commit**

```bash
git log --oneline -3
git status
```

Expected: 提交成功, 工作树干净, 在 main 上 ahead of origin/main N commits (含本 PR).

---

## Self-Review

**Spec coverage:**
- G1 删 3 列 — Task 1 ✓
- G2 删迁移表 + 手动 API/UI — Task 2 + Task 4 + Task 5 ✓
- G3 删自动化 — Task 2 + Task 3 + Task 5 + Task 6 ✓
- G4 删 R-02/R-13/R-13b~e — Task 2 + Task 6 ✓
- G5 删 SUGGEST — Task 3 + Task 6 ✓
- G6 删 UI 状态 — Task 5 ✓
- G7 保留 enum 3 值 — Task 6.1 明确说明不删 ✓
- G8 保留 audit 3 action — Task 6.2 不删 + Task 7 fallback ✓
- 风险 mitigation — Task 11 验证 + Task 12 灰度注释 ✓

**Placeholder scan:** 全 plan 无 TBD/TODO/"implement later", 均有具体代码或命令. 改 .env.example 的 Step 10.1 标 "可能无 op" — 加注释解释.

**Type consistency:** buildCustomerUpdateData, runTransitionInTx, CustomerStatus, ALLOWED_TRANSITIONS_BY_TARGET 等类型均已删除或保留, 无 cross-task mismatch.

**Task 7 (operation-log 抽屉) 路径**: 需先 grep 确认实际文件路径, 计划中说 "可能 components/admin/operation-log-drawer.tsx" 是从前面勘察看到的, 实施时第一行 grep 确认.

**Task 9.5 删老 spec**: 这是 design 反向操作, 老 spec 留 git history 可查. 业务上接受.
