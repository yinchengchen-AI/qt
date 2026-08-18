# Phase 1：个人合同工作台实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增个人合同工作台页面（统计卡 + 待办列表 + 我的合同 ProTable），作为后续 Phase（续签跟进 / 风险预警 / 联动补盲）的统一入口。

**Architecture:** 新增 2 个 API（`GET /api/contracts/my-stats`、`GET /api/contracts/my-todos`），扩展现有 `GET /api/contracts` 加 `mine` 参数（服务端从 session 注入 `ownerUserId`），前端新增工作台页面 `app/(app)/contracts/workbench/page.tsx`（客户端组件，SWR 数据获取），侧边栏新增「合同工作台」菜单项。

**Tech Stack:** Next.js 16 App Router / TypeScript strict / Prisma 7 / antd 6 + ProComponents / SWR / Vitest / Playwright

**设计文档:** `docs/superpowers/specs/2026-08-18-contract-deepening-roadmap-design.md`（§3 Phase 1，v2 已批准）

## Global Constraints

- TypeScript `strict` + `noUncheckedIndexedAccess`；禁止 `@ts-ignore` / `as any`
- 金额必须用 `Prisma.Decimal` 处理，接口出参转 string，前端格式化用 `lib/format.ts#formatCurrency`
- 行级隔离：`mine=true` 时服务端从 session 注入 `ownerUserId`，**忽略**客户端传入的他人 id（防越权枚举）
- 软删除：所有查询带 `deletedAt: null`
- 路由薄壳惯例：`runWithRequestContext` → `requireSession()` → Zod 校验 → service → `ok(data)` / `err(e)`
- 提交信息遵循 Conventional Commits 中文风格（如 `feat(workbench): ...`）
- 权限：`contract:read` 已有权限即可访问，不新增资源位、不写 `OperationLog`（只读操作）
- DB Schema 变更：**无**
- 口径对齐（§3.5 spec）：
  - 到期天数 = `endDate - 今天`：< 0 逾期；0-7 即将到期；8-30 注意；> 30 安全
  - 逾期合同 = `status = ACTIVE 且 endDate < now` + `status = CLOSED 且 reviewComment = "overdue_terminated"`（后者仅统计卡，待办列表只列前者）
  - 即将到期 = `status = ACTIVE 且 endDate ∈ [now, now+7d]`
  - 活跃合同数 = `status = ACTIVE`（含逾期窗口内的）
  - 风险预警 = Phase 2 交付前固定 "—"（占位）

## 代码模式参考（已核对）

### API Route 薄壳模式
```ts
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { ok } from "@/lib/api";

export async function GET(request: Request) {
  return runWithRequestContext(request, async () => {
    const user = await requireSession();
    const data = await getMyStats(user);
    return ok(data);
  });
}
```

### Service 模式（`server/services/contract/overview.ts` 同款）
- 开头 `requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ)`
- 批量预聚合用 `Promise.all([groupBy, groupBy])` + `Map` 查表，**禁止循环内单查（N+1）**

### 客户端页面模式（`app/(app)/dashboard/page.tsx` 同款）
- `"use client"` + `useSWR` + `fetch(url, { credentials: "include" })`
- `StatGrid`（`components/stat-grid.tsx`）接收 `StatItem[]`：`{ label, value, suffix?, icon?, description?, progress?, delta? }`

### 侧边栏菜单（`components/dashboard-shell.tsx` MENU 常量）
- 菜单项带 `permission: { resource: RESOURCE.CONTRACT, action: ACTION.READ }` 过滤

### 合同列表 query（`lib/validators/contract.ts` `contractListQuerySchema`）
- 已有 `page/pageSize/keyword/status/customerId/province/city/district/town/includeLegacyZeroAmount`

---

### Task 1: 我的统计 API（TDD）

**Files:**
- Create: `server/services/contract/workbench.ts`（仅 `getMyStats`）
- Create: `app/api/contracts/my-stats/route.ts`
- Create: `tests/api/contract-workbench.test.ts`

**Interfaces:**
- Produces:
  - `getMyStats(user: SessionUser): Promise<MyStats>`
  - `MyStats = { active: number; expiringSoon: number; overdue: number; risk: number }`
- Consumes: `lib/prisma.ts`、`lib/permissions.ts`、`lib/session.ts`

- [ ] **Step 1: 写失败测试**

创建 `tests/api/contract-workbench.test.ts`（遵循 `tests/api/search.test.ts` 的 DB 可达性 + TAG 前缀 + 自清理模式）：

```ts
// 合同工作台 API 回归
//
// 覆盖:
//   1) my-stats 口径: active=ACTIVE 合同数(含逾期窗口内); expiringSoon=ACTIVE 且 endDate∈[now, now+7d];
//      overdue=ACTIVE 且 endDate<now + CLOSED 且 reviewComment="overdue_terminated"(统计区间内)
//   2) 只统计 ownerUserId=当前用户; 他人合同不计入
//   3) 无合同时返回全 0
//
// DB 不可达时整组 skip. 数据带唯一 TAG 前缀, 跑完自清理.
```

- [ ] **Step 2: 实现 service**

创建 `server/services/contract/workbench.ts`：

```ts
import { prisma } from "@/lib/prisma";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

export type MyStats = {
  active: number;
  expiringSoon: number;
  overdue: number;
  /** Phase 2 风险引擎交付前固定 0, 卡片显示 "—" */
  risk: number;
};

export async function getMyStats(user: SessionUser): Promise<MyStats> {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);

  const now = new Date();
  const in7Days = new Date(now);
  in7Days.setDate(in7Days.getDate() + 7);

  const [activeContracts, overdueClosed] = await Promise.all([
    // 一次查询拿所有 ACTIVE 合同, 在 JS 里按 endDate 分桶 (避免 3 次 count)
    prisma.contract.findMany({
      where: { ownerUserId: user.id, status: "ACTIVE", deletedAt: null },
      select: { id: true, endDate: true }
    }),
    // 统计区间内被强关 (overdue_terminated) 的合同数
    prisma.contract.count({
      where: { ownerUserId: user.id, status: "CLOSED", reviewComment: "overdue_terminated", deletedAt: null }
    })
  ]);

  let expiringSoon = 0;
  let overdue = 0;
  for (const c of activeContracts) {
    if (!c.endDate) continue;
    if (c.endDate < now) overdue++;
    else if (c.endDate <= in7Days) expiringSoon++;
  }

  return { active: activeContracts.length, expiringSoon, overdue: overdue + overdueClosed, risk: 0 };
}
```

- [ ] **Step 3: 实现 API route**

创建 `app/api/contracts/my-stats/route.ts`（薄壳，见模式参考）。

- [ ] **Step 4: 运行测试验证**

```bash
npx vitest run tests/api/contract-workbench.test.ts
```

---

### Task 2: 我的待办 API（TDD）

**Files:**
- Edit: `server/services/contract/workbench.ts`（追加 `getMyTodos`）
- Create: `app/api/contracts/my-todos/route.ts`
- Edit: `tests/api/contract-workbench.test.ts`（追加用例）

**Interfaces:**
- Produces:
  - `getMyTodos(user: SessionUser): Promise<TodoItem[]>`
  - `TodoItem = { id; contractId; contractNo; title; customerName; type: "overdue" | "expiring" | "no_invoice"; priority: 1 | 2 | 3; dueLabel; href }`
- Consumes: `lib/prisma.ts`、`lib/permissions.ts`、`lib/session.ts`

- [ ] **Step 1: 追加测试用例**（同文件追加 describe 块）

覆盖:
- overdue 合同 → `type=overdue, priority=1`
- 7 天内到期 → `type=expiring, priority=2`
- 生效 ≥ 30 天无 ISSUED 发票 → `type=no_invoice, priority=3`
- 排序: priority 升序 (1 > 2 > 3)
- 已完结 / 软删合同不出现; 逾期合同不重复产生其他类型待办

- [ ] **Step 2: 实现 getMyTodos**

```ts
export type TodoItem = {
  id: string;
  contractId: string;
  contractNo: string;
  title: string;
  customerName: string | null;
  type: "overdue" | "expiring" | "no_invoice";
  priority: 1 | 2 | 3;
  dueLabel: string;
  href: string;
};

export async function getMyTodos(user: SessionUser): Promise<TodoItem[]> {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);

  const now = new Date();
  const in7Days = new Date(now);
  in7Days.setDate(in7Days.getDate() + 7);
  const days30Ago = new Date(now);
  days30Ago.setDate(days30Ago.getDate() - 30);

  // 一次查询拿所有 ACTIVE 合同 + 关联发票 id (no_invoice 判定用)
  const contracts = await prisma.contract.findMany({
    where: { ownerUserId: user.id, status: "ACTIVE", deletedAt: null },
    select: {
      id: true, contractNo: true, title: true, endDate: true, startDate: true,
      customer: { select: { name: true } },
      invoices: { where: { deletedAt: null }, select: { id: true, status: true } }
    }
  });

  const todos: TodoItem[] = [];
  const DAY_MS = 86_400_000;

  for (const c of contracts) {
    // 逾期 (priority 1) — 逾期合同不重复产生其他待办
    if (c.endDate && c.endDate < now) {
      const daysOverdue = Math.floor((now.getTime() - c.endDate.getTime()) / DAY_MS);
      todos.push({
        id: `overdue-${c.id}`, contractId: c.id, contractNo: c.contractNo,
        title: c.title, customerName: c.customer?.name ?? null,
        type: "overdue", priority: 1,
        dueLabel: `已逾期 ${daysOverdue} 天`,
        href: `/contracts/${c.id}`
      });
      continue;
    }

    // 7 天内到期 (priority 2)
    if (c.endDate && c.endDate <= in7Days) {
      const daysLeft = Math.ceil((c.endDate.getTime() - now.getTime()) / DAY_MS);
      todos.push({
        id: `expiring-${c.id}`, contractId: c.id, contractNo: c.contractNo,
        title: c.title, customerName: c.customer?.name ?? null,
        type: "expiring", priority: 2,
        dueLabel: `${daysLeft} 天后到期`,
        href: `/contracts/${c.id}`
      });
    }

    // 生效 ≥ 30 天无任何发票记录 (priority 3; 口径与 Phase 3 超期未开票对齐: 无发票)
    if (c.startDate && c.startDate <= days30Ago && c.invoices.length === 0) {
      const daysSinceStart = Math.floor((now.getTime() - c.startDate.getTime()) / DAY_MS);
      todos.push({
        id: `no-invoice-${c.id}`, contractId: c.id, contractNo: c.contractNo,
        title: c.title, customerName: c.customer?.name ?? null,
        type: "no_invoice", priority: 3,
        dueLabel: `生效 ${daysSinceStart} 天未开票`,
        href: `/contracts/${c.id}`
      });
    }
  }

  todos.sort((a, b) => a.priority - b.priority);
  return todos;
}
```

- [ ] **Step 3: 实现 API route**

创建 `app/api/contracts/my-todos/route.ts`（薄壳，同 Task 1）。

- [ ] **Step 4: 运行测试验证**

```bash
npx vitest run tests/api/contract-workbench.test.ts
```

---

### Task 3: 合同列表 mine 过滤

**Files:**
- Edit: `lib/validators/contract.ts`（`contractListQuerySchema` 追加 `mine`）
- Edit: `app/api/contracts/route.ts`（`mine=true` 时注入 `ownerUserId`）
- Edit: `tests/api/contract-workbench.test.ts`（追加越权测试）

**Interfaces:**
- Modifies: `contractListQuerySchema` 追加可选 `mine: z.string().optional()`
- Consumes: `lib/session.ts`（`user.id`）

- [ ] **Step 1: 追加 mine 参数**

在 `contractListQuerySchema` 末尾追加：

```ts
// 个人工作台: mine=true 时服务端强制 ownerUserId=当前用户, 忽略客户端传入
mine: z.string().optional(),
```

- [ ] **Step 2: 追加 mine 过滤逻辑**

读 `app/api/contracts/route.ts` 现有实现，在构造 service 入参前：

```ts
const query = contractListQuerySchema.parse(Object.fromEntries(url.searchParams));
const ownerUserId = query.mine === "true" ? user.id : undefined;
// 传给 service listContracts(user, { ...rest, ownerUserId })
```

**关键**: service 层不接受客户端直接传 `ownerUserId`（除非已有该参数），mine 由路由层从 session 注入。测试必须验证 `?mine=true&ownerUserId=<他人id>` 返回的是当前用户的数据。

- [ ] **Step 3: 追加越权测试**

`tests/api/contract-workbench.test.ts` 追加: 用 A 用户 session 调 `/api/contracts?mine=true`，同时注入 `ownerUserId=B`，断言返回全是 A 的合同（无 B 的）。

- [ ] **Step 4: 运行测试验证**

```bash
npx vitest run tests/api/contract-workbench.test.ts
```

---

### Task 4: 工作台页面 + 侧边栏菜单

**Files:**
- Create: `app/(app)/contracts/workbench/page.tsx`
- Create: `components/workbench/workbench-stat-grid.tsx`（或直接复用 StatGrid 组装）
- Create: `components/workbench/workbench-todo-list.tsx`
- Edit: `components/dashboard-shell.tsx`（MENU 追加「合同工作台」）
- Create: `tests/e2e/NN-workbench.spec.ts`

**Interfaces:**
- Produces: 工作台页面（`"use client"`，SWR）
- Consumes: `/api/contracts/my-stats`、`/api/contracts/my-todos`、`/api/contracts?mine=true`

- [ ] **Step 1: 页面骨架**

`app/(app)/contracts/workbench/page.tsx`:
- `"use client"` + `useSWR`（fetcher 同 dashboard）
- `Page` + `PageHeader`（title="合同工作台"，subtitle 说明个人视角）
- `StatGrid` 4 卡：活跃合同数 / 即将到期 / 逾期合同 / 风险预警（Phase 2 前显示 "—"）
- `WorkbenchTodoList`：待办列表（按 priority 排序，逾期红色 Tag、到期橙色、未开票黄色），每条含合同号/客户/标题/dueLabel + 跳转链接
- `MyContractTable`：复用 `app/(app)/contracts/page.tsx` 的 ProTable 列定义，请求 `/api/contracts?mine=true`

- [ ] **Step 2: 待办列表组件**

`components/workbench/workbench-todo-list.tsx`:
- antd `List` + `Tag`（type→颜色映射: overdue=红 #ff4d4f, expiring=橙 #fa8c16, no_invoice=黄 #faad14）
- 空态用 `EmptyState`
- 每条右侧 `[催款] [续签]` 按钮：Phase 1 只做跳转详情页占位（续签按钮 Phase 1.5 接真逻辑）

- [ ] **Step 3: ExpiryBadge**

`components/workbench/expiry-badge.tsx`（或复用 StatusTag）:
- 输入 endDate，输出四色 Tag：红=逾期、橙=7 天内、黄=30 天内、绿=安全
- 纯函数 + 单测（`tests/unit/workbench-expiry.test.ts`）

- [ ] **Step 4: 侧边栏菜单**

`components/dashboard-shell.tsx` MENU 常量在合同子菜单追加：

```ts
{ key: "/contracts/workbench", label: "合同工作台", icon: <DashboardOutlined /> }
```

（放在「合同列表」上方或作为合同组的第一个子项；permission 继承合同组已有过滤）

- [ ] **Step 5: E2E 测试**

`tests/e2e/NN-workbench.spec.ts`（参照现有 `01-admin-full-flow.spec.ts` 模式）:
- 登录 → 侧边栏进「合同工作台」→ 断言统计卡渲染、待办列表渲染、我的合同表格加载
- 断言 `mine=true` 请求带正确 session（不注入他人 id）

- [ ] **Step 6: 全量验证**

```bash
npm run typecheck && npm run lint && npm test
```

---

## 验收清单（对照 spec §13 Phase 1）

- [ ] 工作台可访问，4 统计卡口径与 §3.5 一致（逾期 = 宽限期内 ACTIVE + 区间内强关）
- [ ] 待办按优先级排序；`mine=true` 无法越权查看他人合同（API 层验证）
- [ ] 到期标签四色正确
- [ ] typecheck / lint / vitest / e2e 全绿

## 提交计划

一个功能收束提交（遵循 AGENTS.md 闭环粒度）：
- `feat(workbench): 个人合同工作台（统计卡 + 待办 + 我的合同）`
- 含 `docs/superpowers/specs/` + `docs/superpowers/plans/` 两个文档
- 版本 bump（`npm version patch`）→ CHANGELOG → 部署（随下一次例行部署或按需）
