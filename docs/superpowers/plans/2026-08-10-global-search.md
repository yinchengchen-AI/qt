# 全局搜索实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 顶栏新增全局搜索框，跨 客户/合同/发票/回款 四类实体检索，下拉分组即时展示，点击直达详情或跳列表页看全部。

**Architecture:** 新增聚合 API `GET /api/search`（service 层 `Promise.all` 并行查 4 表，行级隔离复用 `lib/ownership.ts`），前端新增 `GlobalSearch` 客户端组件（antd AutoComplete + 防抖 + AbortController）插入 DashboardShell Header；4 个列表页补 `?keyword=` URL 初值支持。

**Tech Stack:** Next.js 16 App Router / TypeScript strict / Prisma 7 / antd 6 + ProComponents / Vitest / Playwright

**设计文档:** `docs/superpowers/specs/2026-08-10-global-search-design.md`

## Global Constraints

- TypeScript `strict` + `noUncheckedIndexedAccess`；禁止 `@ts-ignore`
- 金额必须用 `Prisma.Decimal` 处理，接口出参转 string，前端格式化用 `lib/format.ts#formatCurrency`
- 行级隔离：SALES/EXPERT 走 `ownerEq` / `ownerViaContract`（`lib/ownership.ts`），与列表页同口径
- 软删除：所有查询带 `deletedAt: null`
- 路由薄壳惯例：`runWithRequestContext` → `requireSession()` → Zod 校验 → service → `ok(data)` / `err(e)`
- 提交信息遵循 Conventional Commits 中文风格（如 `feat(search): ...`）
- 状态徽标统一用 `components/status-tag.tsx#StatusTag`（domain: `"contract" | "invoice" | "payment"`）
- 不新增权限点；搜索为只读操作，不写 `OperationLog`

---

### Task 1: 搜索校验器 + 聚合 service（TDD）

**Files:**
- Create: `lib/validators/search.ts`
- Create: `server/services/search.ts`
- Test: `tests/api/search.test.ts`

**Interfaces:**
- Produces:
  - `searchQuerySchema` — Zod schema，`{ q: string }`（trim、min(1)、截断 50）
  - `searchAll(user: SessionUser, q: string): Promise<SearchResult>`
  - `SearchResult = { q: string; customers: SearchGroup<CustomerHit>; contracts: SearchGroup<ContractHit>; invoices: SearchGroup<InvoiceHit>; payments: SearchGroup<PaymentHit> }`
  - `SearchGroup<T> = { total: number; items: T[] }`
  - `CustomerHit = { id; code; name; shortName: string|null; contactName: string|null; contactPhone }`（均 string）
  - `ContractHit = { id; contractNo; title; customerName; status }`（均 string）
  - `InvoiceHit = { id; invoiceNo; customerName; amount: string; status: string }`
  - `PaymentHit = { id; paymentNo; customerName; amount: string; status: string }`
  - `escapeLike(raw: string): string`
- Consumes: `lib/ownership.ts` 的 `ownerEq` / `ownerViaContract`；`lib/session.ts#SessionUser`

- [ ] **Step 1: 写校验器**

创建 `lib/validators/search.ts`：

```ts
import { z } from "zod";

// 全局搜索关键字: trim 后至少 1 字符; 超长截断到 50(不报错, 避免暴力输入直接 400)
export const searchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, "请输入搜索关键字")
    .transform((s) => s.slice(0, 50))
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
```

- [ ] **Step 2: 写失败测试**

创建 `tests/api/search.test.ts`（遵循 `tests/api/contract-create-validation.test.ts` 的 DB 可达性 + TAG + 自清理模式）：

```ts
// 全局搜索聚合 service 回归
//
// 覆盖:
//   1) 按客户名 / 信用代码 / 联系人电话 / 合同号 / 发票号 / 回款单号各命中一次
//   2) SALES 行级隔离: 只命中自己名下记录; ADMIN 全量
//   3) 1 字符 q 不查库返回空分组; 含 % 的 q 被转义不命中; 无命中返回全空分组
//   4) 软删除记录不出现
//
// DB 不可达时整组 skip. 数据带唯一 TAG 前缀,跑完自清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { searchAll } from "@/server/services/search";

let dbReachable = false;
const TAG = `TEST-SEARCH-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;

// sales 名下的完整链路: 客户A → 合同A → 发票A / 回款A
// admin 名下的客户B(用于验证 SALES 看不到)
let salesCustomerId: string | null = null;
let adminCustomerId: string | null = null;
let contractId: string | null = null;
let invoiceId: string | null = null;
let paymentId: string | null = null;
let softDeletedCustomerId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const adminRow = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE" },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  const salesRow = await prisma.user.findFirst({
    where: { role: { code: "SALES" }, deletedAt: null, status: "ACTIVE" },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  if (!adminRow || !salesRow) {
    dbReachable = false;
    return;
  }
  adminUser = { ...adminRow, roleCode: "ADMIN", permissions: [] };
  salesUser = { ...salesRow, roleCode: "SALES", permissions: [] };

  // 客户A (sales 名下): 名称/信用代码/联系人电话都含 TAG 变体,便于分组断言
  const custA = await prisma.customer.create({
    data: {
      code: `${TAG}-A`,
      name: `${TAG}-企泰客户`,
      shortName: `${TAG}-企泰`,
      unifiedSocialCreditCode: `91330100${TAG.replace(/[^A-Z0-9]/gi, "X").slice(0, 10)}`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactName: `${TAG}-张三`,
      contactPhone: "13800000999",
      ownerUserId: salesRow.id,
      createdById: salesRow.id,
      updatedById: salesRow.id
    }
  });
  salesCustomerId = custA.id;

  // 客户B (admin 名下): SALES 搜索时不应命中
  const custB = await prisma.customer.create({
    data: {
      code: `${TAG}-B`,
      name: `${TAG}-乙客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000888",
      ownerUserId: adminRow.id,
      createdById: adminRow.id,
      updatedById: adminRow.id
    }
  });
  adminCustomerId = custB.id;

  // 软删除客户 (sales 名下, 名称含 TAG): 不应出现在任何结果里
  const custDel = await prisma.customer.create({
    data: {
      code: `${TAG}-DEL`,
      name: `${TAG}-已删客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000777",
      ownerUserId: salesRow.id,
      createdById: salesRow.id,
      updatedById: salesRow.id,
      deletedAt: new Date()
    }
  });
  softDeletedCustomerId = custDel.id;

  const contract = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-HT-001`,
      customerId: custA.id,
      customerName: custA.name,
      title: `${TAG}-安全评价合同`,
      serviceType: "OTHER",
      signDate: new Date(),
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 86400_000),
      totalAmount: 10000,
      taxRate: 0.06,
      taxAmount: Number((10000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((10000 / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: salesRow.id,
      signerId: salesRow.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: salesRow.id,
      updatedById: salesRow.id
    }
  });
  contractId = contract.id;

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNo: `${TAG}-FP-001`,
      contractId: contract.id,
      customerId: custA.id,
      customerName: custA.name,
      invoiceType: "VAT_SPECIAL",
      amount: 1000,
      taxRate: 0.06,
      taxAmount: Number((1000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((1000 / 1.06).toFixed(2)),
      applyDate: new Date(),
      titleType: "COMPANY",
      titleName: custA.name,
      status: "ISSUED",
      applicantUserId: salesRow.id,
      attachments: [],
      createdById: salesRow.id,
      updatedById: salesRow.id
    }
  });
  invoiceId = invoice.id;

  const payment = await prisma.payment.create({
    data: {
      paymentNo: `${TAG}-SK-001`,
      customerId: custA.id,
      contractId: contract.id,
      invoiceId: invoice.id,
      amount: 1000,
      receivedAt: new Date(),
      method: "BANK_TRANSFER",
      bankRefNo: `${TAG}-REF-001`,
      status: "CONFIRMED",
      recorderUserId: salesRow.id,
      createdById: salesRow.id,
      updatedById: salesRow.id
    }
  });
  paymentId = payment.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  if (paymentId) await prisma.payment.delete({ where: { id: paymentId } }).catch(() => {});
  if (invoiceId) await prisma.invoice.delete({ where: { id: invoiceId } }).catch(() => {});
  if (contractId) await prisma.contract.delete({ where: { id: contractId } }).catch(() => {});
  for (const id of [salesCustomerId, adminCustomerId, softDeletedCustomerId]) {
    if (id) await prisma.customer.delete({ where: { id } }).catch(() => {});
  }
});

describe("searchAll 聚合搜索", () => {
  it("按客户名命中 customers 组", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, `${TAG}-企泰客户`);
    expect(r.customers.total).toBeGreaterThanOrEqual(1);
    expect(r.customers.items.some((c) => c.id === salesCustomerId)).toBe(true);
  });

  it("按统一社会信用代码命中 customers 组", async () => {
    if (!dbReachable || !adminUser) return;
    const cust = await prisma.customer.findUnique({ where: { id: salesCustomerId! } });
    const r = await searchAll(adminUser, cust!.unifiedSocialCreditCode!);
    expect(r.customers.items.some((c) => c.id === salesCustomerId)).toBe(true);
  });

  it("按联系人电话命中 customers 组", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, "13800000999");
    expect(r.customers.items.some((c) => c.id === salesCustomerId)).toBe(true);
  });

  it("按合同号命中 contracts 组", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, `${TAG}-HT-001`);
    expect(r.contracts.items.some((c) => c.id === contractId)).toBe(true);
  });

  it("按发票号命中 invoices 组且金额为 string", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, `${TAG}-FP-001`);
    const hit = r.invoices.items.find((i) => i.id === invoiceId);
    expect(hit).toBeDefined();
    expect(typeof hit!.amount).toBe("string");
  });

  it("按回款单号命中 payments 组且带出客户名", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, `${TAG}-SK-001`);
    const hit = r.payments.items.find((p) => p.id === paymentId);
    expect(hit).toBeDefined();
    expect(hit!.customerName).toContain(TAG);
  });

  it("SALES 只命中自己名下记录", async () => {
    if (!dbReachable || !salesUser) return;
    const r = await searchAll(salesUser, TAG);
    expect(r.customers.items.some((c) => c.id === salesCustomerId)).toBe(true);
    expect(r.customers.items.some((c) => c.id === adminCustomerId)).toBe(false);
    // 乙客户名检索: SALES 视角 total = 0
    const r2 = await searchAll(salesUser, `${TAG}-乙客户`);
    expect(r2.customers.total).toBe(0);
  });

  it("ADMIN 全量可见", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, TAG);
    expect(r.customers.items.some((c) => c.id === adminCustomerId)).toBe(true);
  });

  it("1 字符关键字不查库, 返回全空分组", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, "企");
    expect(r.customers.total).toBe(0);
    expect(r.contracts.total).toBe(0);
    expect(r.invoices.total).toBe(0);
    expect(r.payments.total).toBe(0);
  });

  it("LIKE 通配符 % 被转义, 不会匹配全部", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, "%%");
    expect(r.customers.total).toBe(0);
  });

  it("软删除记录不出现", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, `${TAG}-已删客户`);
    expect(r.customers.items.some((c) => c.id === softDeletedCustomerId)).toBe(false);
    expect(r.customers.total).toBe(0);
  });

  it("无命中返回全空分组而非报错", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, `${TAG}-不存在的关键字`);
    expect(r.customers.total).toBe(0);
    expect(r.contracts.items).toEqual([]);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx vitest run tests/api/search.test.ts`
Expected: FAIL（`@/server/services/search` 模块不存在）

- [ ] **Step 4: 实现 service**

创建 `server/services/search.ts`：

```ts
// 全局搜索聚合: 跨 客户/合同/发票/回款 四类实体, 各取前 5 条 + 命中总数。
// 行级隔离与列表页同口径 (ownerEq / ownerViaContract, 见 lib/ownership.ts);
// 软删除记录一律排除 (deletedAt: null)。
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { ownerEq, ownerViaContract } from "@/lib/ownership";

const GROUP_TAKE = 5;
// 短于 2 字符不查库: 单字符在中文场景几乎无区分度, 且 ILIKE 全表扫代价高
const MIN_KEYWORD_LENGTH = 2;

/** PostgreSQL LIKE 默认转义符是反斜杠; 转义 \ % _ 防止用户输入被当作通配符 */
export function escapeLike(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export type SearchGroup<T> = { total: number; items: T[] };

export type CustomerHit = {
  id: string;
  code: string;
  name: string;
  shortName: string | null;
  contactName: string | null;
  contactPhone: string;
};
export type ContractHit = { id: string; contractNo: string; title: string; customerName: string; status: string };
export type InvoiceHit = { id: string; invoiceNo: string; customerName: string; amount: string; status: string };
export type PaymentHit = { id: string; paymentNo: string; customerName: string; amount: string; status: string };

export type SearchResult = {
  q: string;
  customers: SearchGroup<CustomerHit>;
  contracts: SearchGroup<ContractHit>;
  invoices: SearchGroup<InvoiceHit>;
  payments: SearchGroup<PaymentHit>;
};

const emptyResult = (q: string): SearchResult => ({
  q,
  customers: { total: 0, items: [] },
  contracts: { total: 0, items: [] },
  invoices: { total: 0, items: [] },
  payments: { total: 0, items: [] }
});

export async function searchAll(user: SessionUser, q: string): Promise<SearchResult> {
  const keyword = q.trim().slice(0, 50);
  if (keyword.length < MIN_KEYWORD_LENGTH) return emptyResult(keyword);
  const kw = escapeLike(keyword);
  const like = { contains: kw, mode: "insensitive" as const };

  const customerWhere: Prisma.CustomerWhereInput = {
    deletedAt: null,
    ...ownerEq(user),
    OR: [
      { code: like },
      { name: like },
      { shortName: like },
      { unifiedSocialCreditCode: like },
      { contactName: like },
      { contactPhone: like }
    ]
  };
  const contractWhere: Prisma.ContractWhereInput = {
    deletedAt: null,
    ...ownerEq(user),
    OR: [{ contractNo: like }, { title: like }, { customerName: like }]
  };
  const invoiceWhere: Prisma.InvoiceWhereInput = {
    deletedAt: null,
    ...(ownerViaContract(user) as Prisma.InvoiceWhereInput),
    OR: [{ invoiceNo: like }, { invoiceCode: like }, { customerName: like }]
  };
  const paymentWhere: Prisma.PaymentWhereInput = {
    deletedAt: null,
    ...(ownerViaContract(user) as Prisma.PaymentWhereInput),
    OR: [{ paymentNo: like }, { bankRefNo: like }, { customer: { name: like } }]
  };

  const [customers, customerTotal, contracts, contractTotal, invoices, invoiceTotal, payments, paymentTotal] =
    await Promise.all([
      prisma.customer.findMany({
        where: customerWhere,
        orderBy: { updatedAt: "desc" },
        take: GROUP_TAKE,
        select: { id: true, code: true, name: true, shortName: true, contactName: true, contactPhone: true }
      }),
      prisma.customer.count({ where: customerWhere }),
      prisma.contract.findMany({
        where: contractWhere,
        orderBy: { updatedAt: "desc" },
        take: GROUP_TAKE,
        select: { id: true, contractNo: true, title: true, customerName: true, status: true }
      }),
      prisma.contract.count({ where: contractWhere }),
      prisma.invoice.findMany({
        where: invoiceWhere,
        orderBy: { updatedAt: "desc" },
        take: GROUP_TAKE,
        select: { id: true, invoiceNo: true, customerName: true, amount: true, status: true }
      }),
      prisma.invoice.count({ where: invoiceWhere }),
      prisma.payment.findMany({
        where: paymentWhere,
        orderBy: { updatedAt: "desc" },
        take: GROUP_TAKE,
        select: {
          id: true,
          paymentNo: true,
          amount: true,
          status: true,
          customer: { select: { name: true } }
        }
      }),
      prisma.payment.count({ where: paymentWhere })
    ]);

  return {
    q: keyword,
    customers: { total: customerTotal, items: customers },
    contracts: { total: contractTotal, items: contracts },
    invoices: {
      total: invoiceTotal,
      items: invoices.map((inv) => ({
        id: inv.id,
        invoiceNo: inv.invoiceNo,
        customerName: inv.customerName,
        amount: inv.amount.toString(),
        status: inv.status
      }))
    },
    payments: {
      total: paymentTotal,
      items: payments.map((p) => ({
        id: p.id,
        paymentNo: p.paymentNo,
        customerName: p.customer.name,
        amount: p.amount.toString(),
        status: p.status
      }))
    }
  };
}
```

- [ ] **Step 5: 跑测试确认通过 + typecheck**

Run: `npx vitest run tests/api/search.test.ts`
Expected: PASS（12 个用例；DB 不可达时整组 skip 也算通过）

Run: `npm run typecheck`
Expected: 无 error

- [ ] **Step 6: Commit**

```bash
git add lib/validators/search.ts server/services/search.ts tests/api/search.test.ts
git commit -m "feat(search): 聚合搜索 service(客户/合同/发票/回款, 行级隔离) + 单测"
```

---

### Task 2: 聚合搜索 API 路由

**Files:**
- Create: `app/api/search/route.ts`

**Interfaces:**
- Consumes: `searchAll` / `searchQuerySchema`（Task 1）；`lib/request-context.ts#runWithRequestContext`；`lib/api.ts#ok/err`；`lib/session.ts#requireSession`
- Produces: `GET /api/search?q=...` → `{ code: 0, data: SearchResult }`

- [ ] **Step 1: 写路由（薄壳，与 `app/api/contracts/route.ts` 同构）**

创建 `app/api/search/route.ts`：

```ts
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { searchAll } from "@/server/services/search";
import { searchQuerySchema } from "@/lib/validators/search";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const { q } = searchQuerySchema.parse({ q: url.searchParams.get("q") ?? "" });
      const data = await searchAll(user, q);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
```

- [ ] **Step 2: 起 dev server 冒烟**

Run: `npm run dev`（后台），登录后访问 `http://localhost:3000/api/search?q=<已知客户名片段>`
Expected: `{"code":0,"data":{"q":...,"customers":{...},...}}`；未登录访问返回 401；`?q=` 为空返回 400 VALIDATION_FAILED

- [ ] **Step 3: Commit**

```bash
git add app/api/search/route.ts
git commit -m "feat(search): GET /api/search 聚合搜索路由"
```

---

### Task 3: 前端 GlobalSearch 组件

**Files:**
- Create: `components/global-search.tsx`

**Interfaces:**
- Consumes: `GET /api/search` 响应类型（与 Task 1 的 `SearchResult` 结构一致，组件内自带镜像类型，不跨层 import server 文件）；`components/status-tag.tsx#StatusTag`；`lib/format.ts#formatCurrency`；`lib/use-breakpoint.ts#useResponsive`
- Produces: `<GlobalSearch />`（无 props，内部自适配桌面/手机），供 Task 4 挂入 Header

- [ ] **Step 1: 实现组件**

创建 `components/global-search.tsx`：

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { AutoComplete, Input, Spin, Typography, theme } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useRouter } from "next/navigation";
import { StatusTag } from "@/components/status-tag";
import { formatCurrency } from "@/lib/format";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

// 与 server/services/search.ts 的出参结构镜像 (客户端不 import server 文件)
type Group<T> = { total: number; items: T[] };
type SearchData = {
  q: string;
  customers: Group<{ id: string; code: string; name: string; shortName: string | null; contactName: string | null; contactPhone: string }>;
  contracts: Group<{ id: string; contractNo: string; title: string; customerName: string; status: string }>;
  invoices: Group<{ id: string; invoiceNo: string; customerName: string; amount: string; status: string }>;
  payments: Group<{ id: string; paymentNo: string; customerName: string; amount: string; status: string }>;
};

type Category = "customers" | "contracts" | "invoices" | "payments";
const CATEGORY_LABEL: Record<Category, string> = {
  customers: "客户",
  contracts: "合同",
  invoices: "发票",
  payments: "回款"
};
const CATEGORIES: Category[] = ["customers", "contracts", "invoices", "payments"];

const DEBOUNCE_MS = 300;
const MIN_LEN = 2;

/** 命中片段高亮: 大小写不敏感定位首个命中, 包 <mark> */
function highlight(text: string, q: string, color: string): React.ReactNode {
  const idx = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: "transparent", color, padding: 0, fontWeight: 600 }}>
        {text.slice(idx, idx + q.length)}
      </mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function GlobalSearch() {
  const router = useRouter();
  const { token } = theme.useToken();
  const { isPhone } = useResponsive();
  const [data, setData] = useState<SearchData | null>(null);
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  // 手机端: 图标 → 展开全宽输入条
  const [expanded, setExpanded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doSearch = useCallback((q: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const trimmed = q.trim();
    if (trimmed.length < MIN_LEN) {
      setData(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setFailed(false);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: ctrl.signal });
        const body = (await res.json()) as { code: number; data?: SearchData };
        if (!res.ok || body.code !== 0 || !body.data) throw new Error("search failed");
        setData(body.data);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setData(null);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
  }, []);

  const goto = useCallback(
    (value: string) => {
      // value 编码: hit:<category>:<id> 或 more:<category>
      const [kind, category, id] = value.split(":");
      setOpen(false);
      setExpanded(false);
      if (kind === "more") {
        const base = { customers: "/customers", contracts: "/contracts", invoices: "/invoices", payments: "/payments" }[category as Category];
        router.push(`${base}?keyword=${encodeURIComponent(keyword.trim())}`);
        return;
      }
      const base = { customers: "/customers", contracts: "/contracts", invoices: "/invoices", payments: "/payments" }[category as Category];
      router.push(`${base}/${id}`);
    },
    [router, keyword]
  );

  const buildOptions = () => {
    if (failed) {
      return [{ value: "__failed", disabled: true, label: <Text type="secondary">搜索失败，请重试</Text> }];
    }
    if (!data) return [];
    const q = data.q;
    const groups = CATEGORIES.map((cat) => {
      const g = data[cat];
      const items = g.items.map((item) => {
        let main: React.ReactNode;
        let sub: React.ReactNode;
        if (cat === "customers") {
          const c = item as SearchData["customers"]["items"][number];
          main = highlight(c.name, q, token.colorPrimary);
          sub = `${c.code}${c.contactName ? ` · 联系人:${c.contactName}` : ""}${c.contactPhone ? ` ${c.contactPhone}` : ""}`;
        } else if (cat === "contracts") {
          const c = item as SearchData["contracts"]["items"][number];
          main = <>{highlight(c.contractNo, q, token.colorPrimary)} {highlight(c.title, q, token.colorPrimary)}</>;
          sub = (
            <>
              {c.customerName} <StatusTag status={c.status} domain="contract" />
            </>
          );
        } else if (cat === "invoices") {
          const c = item as SearchData["invoices"]["items"][number];
          main = highlight(c.invoiceNo, q, token.colorPrimary);
          sub = (
            <>
              {c.customerName} · ¥{formatCurrency(c.amount)} <StatusTag status={c.status} domain="invoice" />
            </>
          );
        } else {
          const c = item as SearchData["payments"]["items"][number];
          main = highlight(c.paymentNo, q, token.colorPrimary);
          sub = (
            <>
              {c.customerName} · ¥{formatCurrency(c.amount)} <StatusTag status={c.status} domain="payment" />
            </>
          );
        }
        return {
          value: `hit:${cat}:${item.id}`,
          label: (
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.4, padding: "2px 0" }}>
              <span style={{ fontSize: 13 }}>{main}</span>
              <Text type="secondary" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
                {sub}
              </Text>
            </div>
          )
        };
      });
      if (g.total > g.items.length) {
        items.push({
          value: `more:${cat}`,
          label: (
            <Text type="secondary" style={{ fontSize: 12 }}>
              查看全部 {g.total} 条 ›
            </Text>
          )
        });
      }
      return {
        label: (
          <span style={{ fontSize: 12, fontWeight: 600 }}>
            {CATEGORY_LABEL[cat]} ({g.total})
          </span>
        ),
        options: items
      };
    });
    // 全部为空时给一个提示项
    const totalHits = CATEGORIES.reduce((n, cat) => n + data[cat].total, 0);
    if (totalHits === 0) {
      return [{ value: "__empty", disabled: true, label: <Text type="secondary">未找到匹配“{data.q}”的记录</Text> }];
    }
    return groups;
  };

  const inputEl = (
    <AutoComplete
      value={keyword}
      options={buildOptions()}
      onChange={(v) => {
        setKeyword(v);
        doSearch(v);
      }}
      onSelect={(v) => goto(v)}
      open={open && (loading || data !== null || failed)}
      onDropdownVisibleChange={(v) => setOpen(v)}
      popupMatchSelectWidth={420}
      style={{ width: isPhone ? "100%" : 240 }}
      suffixIcon={loading ? <Spin size="small" /> : undefined}
    >
      <Input
        allowClear
        prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
        placeholder="搜客户 / 合同号 / 发票号 / 回款单"
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
    </AutoComplete>
  );

  // 手机端: 默认一个搜索图标, 点开为全宽输入条 (fixed 在 Header 下方)
  if (isPhone && !expanded) {
    return (
      <button
        type="button"
        aria-label="搜索"
        title="搜索"
        onClick={() => setExpanded(true)}
        style={{
          background: "transparent",
          border: "none",
          padding: 6,
          cursor: "pointer",
          color: token.colorTextSecondary,
          fontSize: 16,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 40,
          minHeight: 40,
          borderRadius: 6
        }}
      >
        <SearchOutlined />
      </button>
    );
  }
  if (isPhone && expanded) {
    return (
      <div
        style={{
          position: "fixed",
          top: 56,
          left: 0,
          right: 0,
          zIndex: 20,
          padding: "8px 12px",
          background: token.colorBgContainer,
          borderBottom: `1px solid ${token.colorSplit}`,
          display: "flex",
          gap: 8,
          alignItems: "center"
        }}
      >
        {inputEl}
        <button
          type="button"
          aria-label="关闭搜索"
          onClick={() => {
            setExpanded(false);
            setOpen(false);
          }}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: token.colorTextSecondary, fontSize: 13 }}
        >
          取消
        </button>
      </div>
    );
  }
  return inputEl;
}
```

- [ ] **Step 2: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: 无 error（若 antd 6 的 AutoComplete 弃用 `onDropdownVisibleChange`，改用 `onOpenChange`，以 typecheck 报错为准）

- [ ] **Step 3: Commit**

```bash
git add components/global-search.tsx
git commit -m "feat(search): GlobalSearch 顶栏搜索组件(防抖/高亮/分组/移动端)"
```

---

### Task 4: DashboardShell Header 集成

**Files:**
- Modify: `components/dashboard-shell.tsx`（import 区 + Header 右侧操作区，约 560 行附近）

**Interfaces:**
- Consumes: `components/global-search.tsx#GlobalSearch`（Task 3）

- [ ] **Step 1: 加 import**

在 `components/dashboard-shell.tsx` 顶部 `import { ReleasePopup, ... }` 一行之后加：

```ts
import { GlobalSearch } from "@/components/global-search";
```

- [ ] **Step 2: 插入 Header 右侧操作区**

在 Header 右侧 `<div style={{ display: "inline-flex", alignItems: "center", gap: ... }}>` 内、`<Badge count={unread} ...>` 之前插入：

```tsx
<GlobalSearch />
```

（组件内部已处理手机端只显示图标，无需外层断点判断。）

- [ ] **Step 3: typecheck + 起 dev server 目检**

Run: `npm run typecheck`，再 `npm run dev` 登录后台
Expected: 顶栏出现搜索框；输入已知客户名片段（≥2 字符）300ms 后出现分组下拉；点击条目跳详情页；手机宽度（<576px）只显示搜索图标，点击展开全宽输入条

- [ ] **Step 4: Commit**

```bash
git add components/dashboard-shell.tsx
git commit -m "feat(search): DashboardShell 顶栏接入 GlobalSearch"
```

---

### Task 5: 列表页 `?keyword=` URL 初值支持

**Files:**
- Modify: `app/(app)/contracts/page.tsx`（import 区 + ProTable props）
- Modify: `app/(app)/invoices/page.tsx`（同上）
- Modify: `app/(app)/payments/page.tsx`（同上）
- Modify: `app/(app)/customers/page.tsx`（已有 `useSearchParams`，只加 ProTable prop）

**Interfaces:**
- Consumes: 无（独立小改）；为 Task 3 的"查看全部 ›"深链落地
- Produces: 四个列表页支持 `?keyword=xxx` 预填搜索表单并参与首次查询

- [ ] **Step 1: contracts / invoices / payments 三页**

每页做两处改动（三页相同，下面以 contracts 为例）：

a) 把第 6 行的：

```ts
import { useRouter } from "next/navigation";
```

改为：

```ts
import { useRouter, useSearchParams } from "next/navigation";
```

b) 页面组件内（其它 `useRouter()` 等 hook 附近）加：

```ts
const searchParams = useSearchParams();
// 全局搜索"查看全部"深链: ?keyword= 预填 ProTable 搜索表单, 首次 request 自动带上
const initialKeyword = searchParams.get("keyword") ?? undefined;
```

c) ProTable 上加 prop（若已有 `form={{...}}` 则合并进 initialValues；当前三页均无 `form` prop，直接新增）：

```tsx
form={{ initialValues: { keyword: initialKeyword } }}
```

注意：`useSearchParams` 在 Next.js 16 要求组件包在 `<Suspense>` 中或页面为客户端动态渲染——这三个页面都是 `"use client"` 且 customers 页已用同款 API 无问题；若 build 报 `useSearchParams() should be wrapped in a suspense boundary`，在对应 `page.tsx` 外层包 `<Suspense fallback={null}>`（customers 页若已包可参照其写法）。

- [ ] **Step 2: customers 页**

`app/(app)/customers/page.tsx` 已有 `const search = useSearchParams();`，在其下方加：

```ts
// 全局搜索"查看全部"深链: ?keyword= 预填关键词表单
const initialKeyword = search.get("keyword") ?? undefined;
```

ProTable 上加：

```tsx
form={{ initialValues: { keyword: initialKeyword } }}
```

（该页 ProTable 当前只有 `formRef={formRef}`，无 `form` prop，直接新增。）

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npm run build`
Expected: 无 error（build 验证 Suspense 边界问题）

手动：dev server 访问 `/contracts?keyword=<已知合同号片段>`，确认搜索表单预填且列表已过滤。

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/contracts/page.tsx" "app/(app)/invoices/page.tsx" "app/(app)/payments/page.tsx" "app/(app)/customers/page.tsx"
git commit -m "feat(search): 列表页支持 ?keyword= URL 初值(承接全局搜索查看全部)"
```

---

### Task 6: e2e 冒烟（可选）

**Files:**
- Create: `tests/e2e/global-search.spec.ts`

**Interfaces:**
- Consumes: `tests/e2e/_dev-credentials.ts#DEV_PASSWORD`；Task 4 已上线的顶栏搜索框

- [ ] **Step 1: 写 spec**

创建 `tests/e2e/global-search.spec.ts`（登录模式与 `05-invoice-payment-flow.spec.ts` 一致）：

```ts
// 全局搜索冒烟: 顶栏输入关键字 → 下拉出现分组与条目 → 点击跳详情页
import { test, expect } from "@playwright/test";
import { DEV_PASSWORD } from "./_dev-credentials";

const stamp = Date.now();
const customerName = `E2E搜索客户-${stamp}`;

async function ensureLoggedIn(page: import("@playwright/test").Page, employeeNo: string, password: string) {
  await page.goto("/dashboard");
  await page.waitForLoadState("networkidle");
  if (page.url().includes("/login")) {
    await page.getByPlaceholder("工号", { exact: true }).fill(employeeNo);
    await page.getByPlaceholder("密码", { exact: true }).fill(password);
    await page.getByRole("button", { name: "登 录", exact: true }).click();
    await page.waitForURL(/dashboard/, { timeout: 10000 });
  }
}

test("顶栏全局搜索命中客户并跳转详情", async ({ page }) => {
  await ensureLoggedIn(page, "admin", DEV_PASSWORD);
  // 用 API 快速造一个客户
  const res = await page.request.post("/api/customers", {
    data: {
      name: customerName,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13812345678"
    }
  });
  expect(res.ok()).toBeTruthy();

  const box = page.getByPlaceholder("搜客户 / 合同号 / 发票号 / 回款单");
  await box.click();
  await box.fill(`搜索客户-${stamp}`);
  // 防抖 300ms + 请求, 断言下拉出现"客户"分组与命中条目
  await expect(page.getByText(/^客户 \([1-9]/).first()).toBeVisible({ timeout: 8000 });
  await page.getByText(customerName, { exact: false }).first().click();
  await page.waitForURL(/\/customers\//, { timeout: 10000 });
  await expect(page.getByText(customerName).first()).toBeVisible();
});
```

- [ ] **Step 2: 跑 e2e**

Run: `npx playwright test tests/e2e/global-search.spec.ts`
Expected: PASS（本地跑不动 Playwright 时记录原因并跳过，不阻塞交付）

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/global-search.spec.ts
git commit -m "test(search): 全局搜索 e2e 冒烟"
```

---

## Self-Review 记录

- **Spec coverage**：API 契约（Task 1/2）、宽字段与通配符转义（Task 1 service + 测试）、行级隔离与软删除（Task 1 测试）、前端交互/防抖/高亮/移动端（Task 3/4）、`?keyword=` 深链（Task 5）、测试与 e2e（Task 1/6）——全部覆盖
- **Placeholder scan**：无 TBD/TODO；所有代码步骤含完整代码
- **Type consistency**：`SearchResult`/`SearchGroup`/`*Hit` 在 Task 1 定义，Task 3 组件内镜像类型字段逐一对应（customers.code/name/shortName/contactName/contactPhone；contracts.contractNo/title/customerName/status；invoices.invoiceNo/customerName/amount/status；payments.paymentNo/customerName/amount/status）
