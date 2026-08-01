# 角色权限重排 + 数据字典优化 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按岗位最佳实践收紧 EXPERT/OPS 权限、角色页只读化；数据字典 9 类枚举约束类目只读防误导 + 修 4 个 bug + 种子合一 + 缓存失效。

**Architecture:** 权限真源保持 `lib/permissions.ts` 硬编码矩阵,`/admin/roles` 降级为只读展示,service 层拒写内置角色;字典复用现有 `DICT_META.readonly` 机制(此前仅 REGION 使用)扩展到 9 个枚举/状态机约束类目,前端各组件已原生支持 readonly,只需翻转标记 + 后端 service 拒写兜底。

**Tech Stack:** Next.js 16 App Router / React 19 / TypeScript strict / Prisma 7 / antd 6 + pro-components / SWR / Vitest / Playwright。

**Spec:** `docs/superpowers/specs/2026-08-02-permissions-dictionary-redesign-design.md`

## Global Constraints

- TypeScript strict(`noUncheckedIndexedAccess` 等),2 空格缩进、单引号在项目里与双引号并存——**match 所在文件现有风格**(lib/server/tests 多为双引号,components 多为双引号)。
- Conventional Commits:`fix(scope): …` / `refactor(scope): …` / `docs(scope): …`,body 可中文;一个逻辑改动一个 commit。
- **禁止** `git commit` 之外的 git 变更操作;每个 Task 末尾的 commit 步骤需用户确认或直接按用户事先授权执行。
- 禁止 `prisma migrate dev`;本计划无 schema 变更、无新迁移。
- 测试命令:`npm test`(Vitest)、`npm run typecheck`、`npm run lint`;单跑一个文件用 `npx vitest run <path>`。
- 不引入新依赖(SWR 已在用,`mutate` 从 `swr` 直接导入)。

---

### Task 1: 权限矩阵收紧(EXPERT 回款/催款、OPS 客户)

**Files:**
- Modify: `lib/permissions.ts`(EXPERT 段 :94-111,OPS 段 :79-93，头部注释 :41)
- Test: `tests/permissions.test.ts`

**Interfaces:**
- Consumes: 现有 `ROLE_PERMISSIONS` / `hasPermission` / `RESOURCE` / `ACTION`。
- Produces: 不变的接口;仅矩阵内容变化。EXPERT: PAYMENT `R+EXPORT`、DUNNING `R`;OPS: CUSTOMER `R+EXPORT`。`scripts/shared/seed-roles.ts` 直接引用 `ROLE_PERMISSIONS`,DB 副本随下次 seed-roles 自动同步,无需改。

- [ ] **Step 1: 先改测试(失败)**

`tests/permissions.test.ts`:

(a) DUNNING 用例(:48-65)中 EXPERT 部分改为只读断言,并把 describe 标题改准:

```ts
  it("DUNNING: SALES 可记录+查看; EXPERT/OPS 只读; FINANCE/ADMIN 拿全 CRUD", () => {
    // 业务现场 (SALES): 仅 CREATE+READ
    expect(hasPermission("SALES", RESOURCE.DUNNING, ACTION.CREATE)).toBe(true);
    expect(hasPermission("SALES", RESOURCE.DUNNING, ACTION.READ)).toBe(true);
    expect(hasPermission("SALES", RESOURCE.DUNNING, ACTION.UPDATE)).toBe(false);
    expect(hasPermission("SALES", RESOURCE.DUNNING, ACTION.DELETE)).toBe(false);
    // 技术专家: 只读 (催款记录归 SALES/财务)
    expect(hasPermission("EXPERT", RESOURCE.DUNNING, ACTION.READ)).toBe(true);
    expect(hasPermission("EXPERT", RESOURCE.DUNNING, ACTION.CREATE)).toBe(false);
    expect(hasPermission("EXPERT", RESOURCE.DUNNING, ACTION.UPDATE)).toBe(false);
    expect(hasPermission("EXPERT", RESOURCE.DUNNING, ACTION.DELETE)).toBe(false);
    // 财务对账留痕: 全 CRUD
    expect(hasPermission("FINANCE", RESOURCE.DUNNING, ACTION.CREATE)).toBe(true);
    expect(hasPermission("FINANCE", RESOURCE.DUNNING, ACTION.UPDATE)).toBe(true);
    expect(hasPermission("FINANCE", RESOURCE.DUNNING, ACTION.DELETE)).toBe(true);
    // 行政只读 (不参与催收)
    expect(hasPermission("OPS", RESOURCE.DUNNING, ACTION.READ)).toBe(true);
    expect(hasPermission("OPS", RESOURCE.DUNNING, ACTION.CREATE)).toBe(false);
  });
```

(b) 在 EXPERT 开票用例(:22-29)后新增两个用例:

```ts
  it("EXPERT 回款只读+导出 (登记回款归 SALES/财务)", () => {
    expect(hasPermission("EXPERT", RESOURCE.PAYMENT, ACTION.READ)).toBe(true);
    expect(hasPermission("EXPERT", RESOURCE.PAYMENT, ACTION.EXPORT)).toBe(true);
    expect(hasPermission("EXPERT", RESOURCE.PAYMENT, ACTION.CREATE)).toBe(false);
    expect(hasPermission("EXPERT", RESOURCE.PAYMENT, ACTION.UPDATE)).toBe(false);
    expect(hasPermission("EXPERT", RESOURCE.PAYMENT, ACTION.DELETE)).toBe(false);
  });

  it("OPS 客户只读+导出 (客户资料 owner 是销售)", () => {
    expect(hasPermission("OPS", RESOURCE.CUSTOMER, ACTION.READ)).toBe(true);
    expect(hasPermission("OPS", RESOURCE.CUSTOMER, ACTION.EXPORT)).toBe(true);
    expect(hasPermission("OPS", RESOURCE.CUSTOMER, ACTION.CREATE)).toBe(false);
    expect(hasPermission("OPS", RESOURCE.CUSTOMER, ACTION.UPDATE)).toBe(false);
    expect(hasPermission("OPS", RESOURCE.CUSTOMER, ACTION.DELETE)).toBe(false);
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/permissions.test.ts`
Expected: FAIL(EXPERT PAYMENT.CREATE 现为 true、EXPERT DUNNING.CREATE 现为 true、OPS CUSTOMER.CREATE 现为 true)

- [ ] **Step 3: 改矩阵**

`lib/permissions.ts`:

(a) :41 注释更新:

```ts
// 内置角色默认权限（硬编码为唯一运行时真源；/admin/roles 仅只读展示,DB 副本由 seed-roles 同步）
```

(b) OPS 段(:83-84)替换:

```ts
    // 客户资料 owner 是销售; 行政只读查阅+导出
    { resource: RESOURCE.CUSTOMER, actions: [...R, ACTION.EXPORT] },
```

(c) EXPERT 段头部注释(:94)替换:

```ts
  // 技术专家: 类似销售跟进自己的客户/合同 (行级隔离同 SALES), 但不管钱 —
  // 发票/回款只读+导出, 催款只读; 商业发起与催收记录归 SALES/财务.
```

(d) EXPERT 的 PAYMENT 行(:104)替换:

```ts
    // 回款: 仅查看/导出自己合同的对账进度; 登记回款归 SALES/财务.
    { resource: RESOURCE.PAYMENT, actions: [...R, ACTION.EXPORT] },
```

(e) EXPERT 的 DUNNING 行(:106-107)替换:

```ts
    // 催收: 仅查看; 现场记录归 SALES, 修改清理由财务负责.
    { resource: RESOURCE.DUNNING, actions: R },
```

> 注:spec §1 提到"同步清理 customer service 为 OPS 写的金额字段过滤逻辑"——已 grep 确认 `server/services/customer/` 中不存在该过滤代码(只有权限矩阵里的注释引用它),无需删除,本 task (b) 已把注释一并更正。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/permissions.test.ts`
Expected: PASS(8 个用例全绿)

- [ ] **Step 5: Commit**

```bash
git add lib/permissions.ts tests/permissions.test.ts
git commit -m "feat(permissions): 收紧 EXPERT 回款/催款与 OPS 客户权限

- EXPERT: PAYMENT CR+EXPORT → R+EXPORT, DUNNING CR → R (跟进客户但不管钱)
- OPS: CUSTOMER CRU+EXPORT → R+EXPORT (客户资料 owner 是销售)
- SALES/FINANCE 不动"
```

---

### Task 2: `/admin/roles` 只读化(消灭"编辑不生效"假功能)

**Files:**
- Modify: `server/services/role.ts`(createRole :64-87,updateRole :96-131，头部注释 :1-5)
- Modify: `app/(app)/admin/roles/page.tsx`
- Modify: `app/(app)/admin/roles/[id]/page.tsx`(去掉编辑按钮 :69-74)
- Modify: `components/admin/permission-matrix.tsx`(RESOURCE_LIST :16-28 补 3 个资源)
- Delete: `app/(app)/admin/roles/new/page.tsx`
- Delete: `app/(app)/admin/roles/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `lib/permissions.ts` 的 `ROLE_PERMISSIONS`(Task 1 后版本);`app/api/roles/route.ts` POST 与 `app/api/roles/[id]/route.ts` PATCH 调用 service,路由本身不改。
- Produces: `createRole` 恒 403;`updateRole` 对 isSystem 角色的 permissions/code 变更 403;`deleteRole` 行为不变(保留作历史自定义角色清理入口)。`PermissionMatrix` 的 `Permission` 类型 `{ resource: string; actions: string[] }` 不变。

- [ ] **Step 1: service 拒写内置角色与自定义角色**

`server/services/role.ts`:

(a) 头部注释(:1-5)替换:

```ts
// 角色管理服务（仅 ADMIN）
// 护栏：
//   - 运行时权限真源 = lib/permissions.ts 的 ROLE_PERMISSIONS 硬编码矩阵;
//     DB Role.permissions 只是 seed 同步的展示副本, 因此:
//   - createRole 一律 403 (自定义角色的 code 不在 RoleCode 联合类型里, 运行时会崩)
//   - 系统角色 (isSystem=true) 的 permissions/code 不可改 (403), name/description 可改
//   - 系统角色不可删; 历史遗留自定义角色可删 (清理入口)
```

(b) `createRole`(:64-87)整个函数体替换(参数 `input` 改名 `_input` 避免 lint unused):

```ts
export async function createRole(actor: SessionUser, _input: RoleCreateInput) {
  requirePermission(actor.roleCode, RESOURCE.ROLE, ACTION.CREATE);
  throw new ApiError(
    ERROR_CODES.FORBIDDEN,
    "自定义角色已停用：内置角色权限由代码矩阵 (lib/permissions.ts) 定义，如需调整请修改代码并发布",
    403
  );
}
```

(c) `updateRole` 在 `const existing = await prisma.role.findUnique(...)` 与 404 检查之后、"改 code 时校验唯一"之前插入:

```ts
  // 系统角色的权限/代码由代码矩阵定义, 只允许改 name/description (展示文案)
  if (
    existing.isSystem &&
    (input.permissions !== undefined || (input.code !== undefined && input.code !== existing.code))
  ) {
    throw new ApiError(
      ERROR_CODES.FORBIDDEN,
      "系统角色的权限与代码由代码矩阵 (lib/permissions.ts) 定义，不可在后台修改",
      403
    );
  }
```

- [ ] **Step 2: typecheck service 改动**

Run: `npm run typecheck`
Expected: 0 errors(若 `defaultPermissionsFor` 或 `RoleCreateInput` 报 unused,保留——它们仍被路由/类型引用)

- [ ] **Step 3: 角色列表页只读化**

`app/(app)/admin/roles/page.tsx`:

(a) import 行加 Alert:

```tsx
import { App as AntdApp, Alert, Button, Tag, Space } from "antd";
```

(b) PageHeader(:101-109)替换为(subtitle 更正,去掉"新建角色"按钮):

```tsx
      <PageHeader
        title="角色权限"
        subtitle="系统内置 5 个角色 · 权限由代码矩阵 (lib/permissions.ts) 定义，本页仅供查看"
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        title="权限的运行时真源是代码矩阵"
        description="本页展示的是 seed 同步到数据库的副本，仅供查看。调整权限请修改 lib/permissions.ts 并发布；历史遗留的自定义角色可在此删除。"
      />
```

(c) 操作列(:77-96)删掉"编辑" Button(:82-84 那个 push 到 `/edit` 的),保留"详情"与"删除"(删除保持 `disabled={r.isSystem}`)。

- [ ] **Step 4: 角色详情页去编辑入口 + 删两个编辑页**

(a) `app/(app)/admin/roles/[id]/page.tsx`:删除 PageHeader 的 `actions={...}` 块(:69-74),并删除顶部 `import { useParams, useRouter } from "next/navigation";` 改为 `import { useParams } from "next/navigation";`,删除 `const router = useRouter();`(:31)。

(b) 删除两个编辑页文件:

```bash
rm "app/(app)/admin/roles/new/page.tsx" "app/(app)/admin/roles/[id]/edit/page.tsx"
```

- [ ] **Step 5: PermissionMatrix 补全 14 资源**

`components/admin/permission-matrix.tsx` RESOURCE_LIST(:16-28)替换为:

```ts
const RESOURCE_LIST: { value: string; label: string; group?: string }[] = [
  { value: RESOURCE.USER, label: "用户", group: "系统" },
  { value: RESOURCE.ROLE, label: "角色", group: "系统" },
  { value: RESOURCE.DICTIONARY, label: "字典", group: "系统" },
  { value: RESOURCE.OPERATION_LOG, label: "操作日志", group: "系统" },
  { value: RESOURCE.DEPARTMENT, label: "部门", group: "系统" },
  { value: RESOURCE.APP_RELEASE, label: "更新日志", group: "系统" },
  { value: RESOURCE.CUSTOMER, label: "客户", group: "业务" },
  { value: RESOURCE.CONTRACT, label: "合同", group: "业务" },
  { value: RESOURCE.DUNNING, label: "催款", group: "业务" },
  { value: RESOURCE.INVOICE, label: "开票", group: "财务" },
  { value: RESOURCE.PAYMENT, label: "回款", group: "财务" },
  { value: RESOURCE.STATISTICS, label: "统计", group: "分析" },
  { value: RESOURCE.MESSAGE, label: "消息", group: "运营" },
  { value: RESOURCE.ANNOUNCEMENT, label: "公告", group: "运营" }
];
```

(原列表缺 DEPARTMENT/DUNNING/APP_RELEASE,只读展示 14 资源才完整。)

- [ ] **Step 6: 验证**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors。注意确认没有残留对 `/admin/roles/new`、`/admin/roles/${id}/edit` 的引用:

Run: `grep -rn "roles/new\|roles/.*edit" app/ components/ --include="*.tsx" | grep -v "admin/roles/\[id\]/page.tsx"` — Expected: 无输出或只剩无关命中。

- [ ] **Step 7: Commit**

```bash
git add server/services/role.ts "app/(app)/admin/roles" components/admin/permission-matrix.tsx
git commit -m "refactor(permissions): /admin/roles 改为只读展示

- createRole 一律 403; 系统角色 permissions/code 拒改 (运行时只认代码矩阵)
- 列表页去新建/编辑入口, 加真源说明 Alert; 详情页去编辑按钮
- 删除 /admin/roles/new 与 /admin/roles/[id]/edit 页面
- PermissionMatrix 补全 14 资源展示"
```

---

### Task 3: `DICT_META` 9 个枚举约束类目翻 readonly

**Files:**
- Modify: `lib/dict-domain.ts`(DICT_META :38-59,BUSINESS_CATEGORIES :96-97)

**Interfaces:**
- Consumes: `lib/dictionary-categories.ts` 的 `ALLOWED_DICTIONARY_CATEGORIES`。
- Produces: `DICT_META[category].readonly: boolean`(9 个新翻 true);`isSystemCategory(category)` 语义不变(读 readonly);`BUSINESS_CATEGORIES: string[]` 改为白名单派生(16 类全集,不含 REGION)。前端组件(DictCategorySider/DictCategoryContent/DictTableView/page.tsx/CreateDictDrawer)已按 readonly 渲染锁标与禁写,本 task 落地后这些类目 UI 自动只读。

- [ ] **Step 1: 翻转 9 类 readonly + 更新 description**

`lib/dict-domain.ts` 中对以下 9 个条目把 `readonly: false` 改为 `readonly: true`,description 替换(其余条目不动):

```ts
  CUSTOMER_TYPE: { category: "CUSTOMER_TYPE", label: "客户类型", shape: "table", readonly: true, description: "code 由 types/enums.ts CUSTOMER_TYPE 枚举 + 客户校验 (zod) 约束, 仅供查看" },
  CUSTOMER_SCALE: { category: "CUSTOMER_SCALE", label: "客户规模", shape: "table", readonly: true, description: "code 由 types/enums.ts CUSTOMER_SCALE 枚举 + 客户校验 (zod) 约束, 仅供查看" },
```

```ts
  CONTRACT_PAYMENT_METHOD: { category: "CONTRACT_PAYMENT_METHOD", label: "合同付款方式", shape: "table", readonly: true, description: "code 由 types/enums.ts + 合同校验 (zod) 约束, 仅供查看" },
  INVOICE_TYPE: { category: "INVOICE_TYPE", label: "发票类型", shape: "table", readonly: true, description: "code 由发票校验 (zod) + INVOICE_TYPE_MAP 约束, 仅供查看" },
  PAYMENT_RECEIVE_METHOD: { category: "PAYMENT_RECEIVE_METHOD", label: "收款方式", shape: "table", readonly: true, description: "code 由回款校验 (zod) 约束, 仅供查看" },
  REVIEW_ACTION: { category: "REVIEW_ACTION", label: "审批动作", shape: "table", readonly: true, description: "审批动作由代码状态机约束 (REVIEW_ACTION_MAP), 仅供查看" },
```

```ts
  CONTRACT_STATUS: { category: "CONTRACT_STATUS", label: "合同状态", shape: "table", readonly: true, description: "合同状态机由代码驱动 (CONTRACT_STATUS_MAP), 仅供查看" },
  INVOICE_STATUS: { category: "INVOICE_STATUS", label: "开票状态", shape: "table", readonly: true, description: "开票状态机由代码驱动 (INVOICE_STATUS_MAP), 仅供查看" },
  PAYMENT_STATUS: { category: "PAYMENT_STATUS", label: "回款状态", shape: "table", readonly: true, description: "回款状态机由代码驱动 (PAYMENT_STATUS_MAP), 仅供查看" },
```

同时更新文件头注释(:2-4)第 4 行:

```ts
//   - dict-domain.ts: 类目按域分组 + UI 形态 + 只读护栏 (前端展示 + service 拒写用)
```

- [ ] **Step 2: BUSINESS_CATEGORIES 改为白名单派生**

`lib/dict-domain.ts` 顶部加 import(文件目前无 import):

```ts
import { ALLOWED_DICTIONARY_CATEGORIES } from "@/lib/dictionary-categories";
```

:96-97 替换为:

```ts
/** 业务类白名单 (与 ALLOWED_DICTIONARY_CATEGORIES 一致, 排除 REGION);
 *  readonly 类目也在列 — 只读只是禁写, 类目列表/下拉的类目全集不变 */
export const BUSINESS_CATEGORIES: string[] = [...ALLOWED_DICTIONARY_CATEGORIES];
```

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors。

- [ ] **Step 4: Commit**

```bash
git add lib/dict-domain.ts
git commit -m "feat(dictionary): 9 个枚举/状态机约束类目标记只读

CUSTOMER_TYPE/CUSTOMER_SCALE/CONTRACT_PAYMENT_METHOD/INVOICE_TYPE/
PAYMENT_RECEIVE_METHOD/REVIEW_ACTION/CONTRACT_STATUS/INVOICE_STATUS/
PAYMENT_STATUS 的 code 被 zod 枚举或状态机硬编码约束, 字典页修改不生效,
翻 readonly 防误导; BUSINESS_CATEGORIES 改为白名单派生"
```

---

### Task 4: 字典 service 只读拒写 + code 正则放宽(后端)

**Files:**
- Modify: `server/services/dictionary.ts`(头部注释 :1-4,新增 assertWritableCategory,createDict :70-72,updateDict :124-127,softDisableDict :148-151,reorder :167-172)
- Modify: `lib/validators/dictionary.ts`(:8 正则)
- Modify: `lib/dictionary-categories.ts`(:1 注释 15→16)
- Test: `tests/unit/server/dictionary-readonly.test.ts`(新建)

**Interfaces:**
- Consumes: Task 3 的 `DICT_META.readonly`。
- Produces: `assertWritableCategory(cat: string): void`(模块内私有,不导出);create/update/disable/reorder 对 readonly 类目抛 `ApiError(FORBIDDEN, …, 403)`;`dictCreateSchema` code 正则放宽为 `/^[A-Z][A-Z0-9_.]*$/`(允许点号,与前端 CreateDictDrawer 及存量树形 code 如 `R2.30` 对齐)。

- [ ] **Step 1: 先写失败测试**

新建 `tests/unit/server/dictionary-readonly.test.ts`:

```ts
// 只读类目 (lib/dict-domain.ts DICT_META.readonly) 拒写回归:
// createDict / updateDict / softDisableDict / reorder 对 readonly 类目一律 403;
// 非白名单类目仍 400; 可写类目不受影响。
// 不连真实 DB, 用 vi.mock 拦截 prisma (pattern 同 tests/unit/server/contract-create-owner.test.ts)
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    dictionary: {
      findUnique: vi.fn(async () => ({
        id: "d-1",
        category: "CONTRACT_STATUS",
        code: "DRAFT",
        label: "草稿",
        isActive: true
      })),
      findMany: vi.fn(async () => [{ category: "CONTRACT_STATUS" }]),
      create: vi.fn(),
      update: vi.fn()
    },
    $transaction: vi.fn()
  }
}));

vi.mock("@/server/audit", () => ({ audit: vi.fn(async () => ({})) }));

import { createDict, updateDict, softDisableDict, reorder } from "@/server/services/dictionary";
import type { SessionUser } from "@/lib/session";

const ADMIN = { id: "u-admin", roleCode: "ADMIN" } as unknown as SessionUser;

describe("dictionary 只读类目拒写", () => {
  it("createDict: readonly 类目 (CONTRACT_STATUS) → 403", async () => {
    await expect(
      createDict(ADMIN, { category: "CONTRACT_STATUS", code: "X_NEW", label: "新状态" })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("updateDict: 目标属于 readonly 类目 → 403", async () => {
    await expect(updateDict(ADMIN, "d-1", { label: "改名" })).rejects.toMatchObject({ status: 403 });
  });

  it("softDisableDict: 目标属于 readonly 类目 → 403", async () => {
    await expect(softDisableDict(ADMIN, "d-1")).rejects.toMatchObject({ status: 403 });
  });

  it("reorder: 涉及 readonly 类目 → 403", async () => {
    await expect(reorder(ADMIN, [{ id: "d-1", sort: 1 }])).rejects.toMatchObject({ status: 403 });
  });

  it("createDict: 非白名单类目仍 400", async () => {
    await expect(
      createDict(ADMIN, { category: "FAKE_CATEGORY", code: "X", label: "x" })
    ).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/unit/server/dictionary-readonly.test.ts`
Expected: 前 4 个用例 FAIL(当前 service 只校验白名单,CONTRACT_STATUS 在白名单内会通过)

- [ ] **Step 3: service 加 readonly 拒写**

`server/services/dictionary.ts`:

(a) 头部注释(:1-4)替换:

```ts
// 数据字典服务
// - 16 类白名单（不允许新建 category）
// - 只读类目 (lib/dict-domain.ts DICT_META.readonly: 枚举/状态机约束类 + REGION) 拒写
// - 增/改/启停/重排；删除 = 软停用 isActive=false
// - 客户/合同等业务表 code 外键悬空风险,不允许硬删
```

(b) import 区加:

```ts
import { DICT_META } from "@/lib/dict-domain";
```

(c) `assertAllowedCategory` 之后新增:

```ts
function assertWritableCategory(cat: string) {
  if (DICT_META[cat]?.readonly) {
    throw new ApiError(
      ERROR_CODES.FORBIDDEN,
      `类目 ${cat} 由系统枚举/状态机控制，不可在数据字典中修改`,
      403
    );
  }
}
```

(d) `createDict` 在 `assertAllowedCategory(input.category);`(:72)后加一行:

```ts
  assertWritableCategory(input.category);
```

(e) `updateDict` 在 404 检查(:127)后加:

```ts
  assertWritableCategory(existing.category);
```

(f) `softDisableDict` 在 404 检查(:151)后加:

```ts
  assertWritableCategory(existing.category);
```

(g) `reorder` 在 `requirePermission`(:171)后、事务前加:

```ts
  const rows = await prisma.dictionary.findMany({
    where: { id: { in: items.map((i) => i.id) } },
    select: { category: true }
  });
  for (const r of rows) assertWritableCategory(r.category);
```

- [ ] **Step 4: code 正则放宽 + 注释更正**

(a) `lib/validators/dictionary.ts` :8 替换:

```ts
  code: z.string().min(1, "代码必填").max(40).regex(/^[A-Z][A-Z0-9_.]*$/, "代码需以大写字母开头，仅允许大写字母/数字/下划线/点"),
```

(b) `lib/dictionary-categories.ts` :1 注释替换:

```ts
// 字典 16 类白名单 — service 校验 / 前端下拉 / seed 一致
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx vitest run tests/unit/server/dictionary-readonly.test.ts`
Expected: PASS 5/5

- [ ] **Step 6: Commit**

```bash
git add server/services/dictionary.ts lib/validators/dictionary.ts lib/dictionary-categories.ts tests/unit/server/dictionary-readonly.test.ts
git commit -m "feat(dictionary): service 层拒写只读类目 + code 正则允许点号

- create/update/disable/reorder 对 DICT_META.readonly 类目 403 (不只靠前端藏按钮)
- dictCreateSchema code 正则放宽允许点号, 与前端及存量树形 code (R2.30) 对齐
- 更正 15 类→16 类过时注释"
```

---

### Task 5: `buildDictTree` 提取到 lib + 测试改真实 import

**Files:**
- Create: `lib/dict-tree.ts`
- Modify: `app/api/dictionaries/route.ts`(删 :80-129 本地定义,改 import)
- Test: `tests/api/dict-tree.test.ts`(重写为 import 真实实现)

**Interfaces:**
- Consumes: 无。
- Produces: `lib/dict-tree.ts` 导出 `DictTreeNode`、`buildDictTree(flat: DictFlatRow[]): DictTreeNode[]`;路由行为不变。

- [ ] **Step 1: 先重写测试(失败)**

`tests/api/dict-tree.test.ts` 整个文件替换为:

```ts
import { describe, it, expect } from "vitest";
import { buildDictTree, type DictFlatRow } from "@/lib/dict-tree";

const row = (code: string, label: string, parentCode: string | null): DictFlatRow => ({
  id: `id-${code}`,
  code,
  label,
  parentCode,
  sort: 0,
  isActive: true
});

describe("buildDictTree (REGION 字典)", () => {
  const sample: DictFlatRow[] = [
    row("R1", "杭州市", null),
    row("R1.2", "余杭区", "R1"),
    row("R1.25", "临平区", "R1"),
    row("R2.4", "余杭区 · 黄湖镇", "R1.2"),
    row("R2.5", "余杭区 · 百丈镇", "R1.2"),
    row("R2.10", "余杭区 · 中泰街道", "R1.2"),
    row("R25.3", "临平区 · 临平街道", "R1.25"),
    row("R25.17", "临平区 · 运河街道", "R1.25")
  ];

  it("3 级嵌套: 杭州 > 余杭/临平 > 街道", () => {
    const tree = buildDictTree(sample);
    expect(tree).toHaveLength(1);
    const r1 = tree[0]!;
    expect(r1.code).toBe("R1");
    expect(r1.children).toHaveLength(2);
    const r12 = r1.children[0]!;
    expect(r12.code).toBe("R1.2");
    expect(r12.children).toHaveLength(3);
  });

  it("子级按原数组顺序保留(不重新排序)", () => {
    const tree = buildDictTree(sample);
    const r12 = tree[0]!.children[0]!;
    expect(r12.children.map((s) => s.code)).toEqual(["R2.4", "R2.5", "R2.10"]);
  });

  it("叶子节点 children 为空数组", () => {
    const tree = buildDictTree(sample);
    const leaves = tree[0]!.children.flatMap((c) => c.children);
    for (const leaf of leaves) {
      expect(leaf.children).toEqual([]);
    }
  });

  it("孤儿节点 (parentCode 引用不存在的 code) 作为顶级", () => {
    const tree = buildDictTree([row("A", "A", null), row("ORPHAN", "ORPHAN", "GHOST")]);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.code)).toEqual(["A", "ORPHAN"]);
  });

  it("空数组返回空数组", () => {
    expect(buildDictTree([])).toEqual([]);
  });

  it("只有顶级时返回平铺顶级列表", () => {
    const tree = buildDictTree([row("A", "A", null), row("B", "B", null)]);
    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/api/dict-tree.test.ts`
Expected: FAIL(`@/lib/dict-tree` 不存在)

- [ ] **Step 3: 提取实现**

新建 `lib/dict-tree.ts`(函数体从 `app/api/dictionaries/route.ts` :80-129 原样搬出):

```ts
/**
 * 把扁平字典 (有 parentCode 字段) 拼成 antd TreeData 格式
 *   顶级: { code, label, children: [...] }
 *   子级递归
 *   parentCode 引用不存在的 code 会被忽略 (作为顶级)
 */
export type DictTreeNode = {
  id: string;
  code: string;
  label: string;
  parentCode: string | null;
  isActive: boolean;
  children: DictTreeNode[];
};

export type DictFlatRow = {
  id: string;
  code: string;
  label: string;
  parentCode: string | null;
  sort: number;
  isActive: boolean;
};

export function buildDictTree(flat: DictFlatRow[]): DictTreeNode[] {
  type Node = DictTreeNode & { _raw: DictFlatRow };
  const map = new Map<string, Node>();
  for (const f of flat) {
    map.set(f.code, {
      id: f.id,
      code: f.code,
      label: f.label,
      parentCode: f.parentCode,
      isActive: f.isActive,
      children: [],
      _raw: f
    });
  }
  const roots: Node[] = [];
  for (const f of flat) {
    const node = map.get(f.code)!;
    if (f.parentCode && map.has(f.parentCode)) {
      map.get(f.parentCode)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // UI 只要 code/label/children (去除内部 _raw)
  return roots.map(({ id, code, label, parentCode, isActive, children }) => ({
    id,
    code,
    label,
    parentCode,
    isActive,
    children
  }));
}
```

`app/api/dictionaries/route.ts`:删除 :74-129 的注释+类型+函数定义,在 import 区加:

```ts
import { buildDictTree } from "@/lib/dict-tree";
```

- [ ] **Step 4: 跑测试确认通过 + typecheck**

Run: `npx vitest run tests/api/dict-tree.test.ts && npm run typecheck`
Expected: PASS 6/6,0 errors

- [ ] **Step 5: Commit**

```bash
git add lib/dict-tree.ts app/api/dictionaries/route.ts tests/api/dict-tree.test.ts
git commit -m "refactor(dictionary): buildDictTree 提取到 lib/dict-tree.ts

测试从复刻逻辑改为 import 真实实现, 防漂移"
```

---

### Task 6: `dict-create-schema.test.ts` 改真实 import

**Files:**
- Test: `tests/lib/dict-create-schema.test.ts`(重写)

**Interfaces:**
- Consumes: Task 4 的 `dictCreateSchema`(正则已允许点号)。
- Produces: 无新接口。

- [ ] **Step 1: 重写测试**

`tests/lib/dict-create-schema.test.ts` 整个文件替换为:

```ts
import { describe, it, expect } from "vitest";
import { dictCreateSchema } from "@/lib/validators/dictionary";

describe("dictCreateSchema", () => {
  it("顶级 (parentCode 未传) 通过", () => {
    const v = dictCreateSchema.parse({ category: "SERVICE_TYPE", code: "NEW_TYPE", label: "测试顶级", sort: 1 });
    expect(v.parentCode).toBeUndefined();
  });

  it("顶级 (parentCode=null) 通过", () => {
    const v = dictCreateSchema.parse({ category: "SERVICE_TYPE", code: "NEW_TYPE", label: "顶级", parentCode: null, sort: 1 });
    expect(v.parentCode).toBeNull();
  });

  it("子级 (parentCode='NEW_TYPE') 通过", () => {
    const v = dictCreateSchema.parse({ category: "SERVICE_TYPE", code: "NEW_TYPE_CHILD", label: "测试子级", parentCode: "NEW_TYPE", sort: 1 });
    expect(v.parentCode).toBe("NEW_TYPE");
  });

  it("parentCode 长度超过 40 被拒", () => {
    expect(() => dictCreateSchema.parse({
      category: "SERVICE_TYPE", code: "NEW_TYPE", label: "x", parentCode: "A".repeat(41)
    })).toThrow();
  });

  it("空 parentCode 字符串被拒 (min 1)", () => {
    expect(() => dictCreateSchema.parse({
      category: "SERVICE_TYPE", code: "NEW_TYPE", label: "x", parentCode: ""
    })).toThrow();
  });

  it("支持带点的 code (NEW_TYPE.30) 树形编码", () => {
    const v = dictCreateSchema.parse({
      category: "SERVICE_TYPE", code: "NEW_TYPE.30", label: "新街道", parentCode: "NEW_TYPE", sort: 30
    });
    expect(v.code).toBe("NEW_TYPE.30");
    expect(v.parentCode).toBe("NEW_TYPE");
  });

  it("category 不在白名单被拒", () => {
    expect(() => dictCreateSchema.parse({ category: "FAKE_CATEGORY", code: "X", label: "x" })).toThrow();
  });

  it("已废弃/移出类目被拒 (CUSTOMER_STATUS / PROJECT_STATUS 不在 16 类白名单)", () => {
    expect(() => dictCreateSchema.parse({ category: "CUSTOMER_STATUS", code: "X", label: "x" })).toThrow();
    expect(() => dictCreateSchema.parse({ category: "PROJECT_STATUS", code: "X", label: "x" })).toThrow();
  });

  it("code 必须大写字母开头", () => {
    expect(() => dictCreateSchema.parse({ category: "SERVICE_TYPE", code: "lowercase", label: "x" })).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认通过**

Run: `npx vitest run tests/lib/dict-create-schema.test.ts`
Expected: PASS 9/9(注意:本 task 依赖 Task 4 的正则放宽先落地,否则"带点的 code"用例失败)

- [ ] **Step 3: Commit**

```bash
git add tests/lib/dict-create-schema.test.ts
git commit -m "test(dictionary): dict-create-schema 测试改为 import 真实 schema

消除复刻版漂移 (含已删的 CUSTOMER_STATUS/PROJECT_STATUS 与点号正则不一致)"
```

---

### Task 7: 字典前端修 bug(DictEditDrawer 只读 key、DictRow 补 category、CreateDictDrawer 过滤只读类目)

**Files:**
- Modify: `app/(app)/admin/dictionaries/_components/DictTableView.tsx`(DictRow :7-15)
- Modify: `app/(app)/admin/dictionaries/_components/DictEditDrawer.tsx`(:31,:86-93)
- Modify: `app/(app)/admin/dictionaries/_components/CreateDictDrawer.tsx`(:121-129,:131-140)
- Modify: `app/(app)/admin/dictionaries/page.tsx`(REGION 行构造 :54-67,onTreeSelect :179-190)

**Interfaces:**
- Consumes: Task 3 的 readonly 标记。
- Produces: `DictRow` 增加 `category: string` 字段(所有构造点同步);两个 Drawer 的 `onSaved` 签名本 task 不变(Task 8 才改)。

- [ ] **Step 1: DictRow 加 category 字段**

`DictTableView.tsx` :7-15 替换为:

```ts
export type DictRow = {
  id: string;
  category: string;
  code: string;
  label: string;
  sort: number;
  isActive: boolean;
  parentCode: string | null;
  createdAt: string;
};
```

- [ ] **Step 2: page.tsx 两处构造点补 category**

(a) REGION 分支的 `flat.push({...})`(:56-64)加 `category: "REGION",`:

```ts
            flat.push({
              id: n.id,
              category: "REGION",
              code: n.code,
              label: n.label,
              sort: 0,
              isActive: n.isActive,
              parentCode: n.parentCode,
              createdAt: ""
            });
```

(新分支 `setRows(j.data.list ?? [])` 的 API 返回自带 category,无需改。)

(b) `onTreeSelect`(:181-189)的 setEditTarget 对象加 `category: "REGION",`:

```ts
    setEditTarget({
      id: node.id,
      category: "REGION",
      code: node.code,
      label: node.label,
      sort: 0,
      isActive: node.isActive,
      parentCode: node.parentCode,
      createdAt: ""
    });
```

- [ ] **Step 3: DictEditDrawer 只读判断改用 category + 文案泛化**

`DictEditDrawer.tsx`:

(a) :31 替换:

```ts
  const readonlyByCategory = dict ? (DICT_META[dict.category]?.readonly ?? false) : false;
```

(b) Alert(:87-93)替换(REGION 与枚举约束类共用一套文案):

```tsx
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              title="只读类目 · 不可在 UI 中编辑"
              description="该类目由系统枚举/状态机或同步脚本控制，此处仅供查看。"
            />
```

- [ ] **Step 4: CreateDictDrawer 新增下拉过滤只读类目 + 文案泛化**

`CreateDictDrawer.tsx`:

(a) category Select 的 options(:132-137)替换:

```tsx
            options={ALLOWED_DICTIONARY_CATEGORIES.filter((c) => !isSystemCategory(c)).map((c) => ({
              value: c,
              label: DICTIONARY_CATEGORY_LABEL[c] ?? c
            }))}
```

(b) Alert(:122-129)替换:

```tsx
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          title="只读类目不可在 UI 中新增"
          description="该类目由系统枚举/状态机或同步脚本管理，请在对应的数据源中修改。"
        />
```

- [ ] **Step 5: 验证**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors(重点:DictRow 加字段后所有构造点已补 category)

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/admin/dictionaries"
git commit -m "fix(dictionary): DictEditDrawer 只读判断改用 category + 新增下拉过滤只读类目

- 原先用 dict.code 查 DICT_META 恒为 false, REGION 只读可被 PATCH 绕过
- DictRow 补 category 字段; 只读文案泛化 (REGION/枚举约束类共用)"
```

---

### Task 8: `refreshDict` 真修复 + admin 页写操作后失效缓存

**Files:**
- Modify: `lib/dict-client.ts`(去 subs/notify 死代码,refreshDict 用 SWR mutate)
- Modify: `app/(app)/admin/dictionaries/page.tsx`(onToggleActive :139-150,onBatchSetActive :152-172,两个 Drawer 的 onSaved :290-303)
- Modify: `app/(app)/admin/dictionaries/_components/DictEditDrawer.tsx`(onSaved 签名带 category)
- Modify: `app/(app)/admin/dictionaries/_components/CreateDictDrawer.tsx`(onSaved 签名带 category)

**Interfaces:**
- Consumes: SWR(`mutate` 从 `swr` 导入,项目已有依赖)。
- Produces: `refreshDict(category: string): Promise<void>`(签名不变,行为变为"重拉 + 触发挂载中的 `useDict(category)` 重渲染");两个 Drawer 的 `onSaved: (category: string) => void`。

- [ ] **Step 1: 修 dict-client**

`lib/dict-client.ts`:

(a) :3 替换:

```ts
import useSWR, { mutate } from "swr";
```

(b) 删除 :7 的 `const subs = ...` 与 :25-27 的 `notify` 函数。

(c) `useDict` 内删除 :42 的 `if (!subs.has(category)) subs.set(category, new Set());`。

(d) `refreshDict`(:47-51)替换:

```ts
export async function refreshDict(category: string) {
  cache.delete(category);
  const data = await fetchDict(category);
  cache.set(category, data);
  // 触发所有挂载中的 useDict(category) 用新数据重渲染 (SWR key 与 useDict 内部一致)
  await mutate(["dict", category], data, { revalidate: false });
}
```

- [ ] **Step 2: 两个 Drawer 的 onSaved 带 category**

(a) `DictEditDrawer.tsx` Props(:8-13)改:

```ts
type Props = {
  open: boolean;
  dict: DictRow | null;
  onClose: () => void;
  onSaved: (category: string) => void;
};
```

`onSubmit` 内 :50 `onSaved();` 改为 `onSaved(dict.category);`。

(b) `CreateDictDrawer.tsx` Props(:7-16)的 onSaved 同样改为 `(category: string) => void`;`onSubmit` 内 :84 `onSaved();` 改为 `onSaved(v.category);`。

- [ ] **Step 3: admin 页接 refreshDict**

`page.tsx`:

(a) import 区加:

```ts
import { refreshDict } from "@/lib/dict-client";
```

(b) `onToggleActive` 的 `message.success(...)` 后、`fetchRows()` 前加:

```ts
    void refreshDict(selected);
```

(c) `onBatchSetActive` 的 `setSelectedIds(new Set());` 后加:

```ts
    void refreshDict(selected);
```

(d) 两个 Drawer 的 onSaved(:294,:300)都改为:

```tsx
        onSaved={(cat) => { fetchRows(); void refreshDict(cat); }}
```

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors。再 `grep -rn "notify\|subs" lib/dict-client.ts` 确认死代码清干净(Expected: 无输出)。

- [ ] **Step 5: Commit**

```bash
git add lib/dict-client.ts "app/(app)/admin/dictionaries"
git commit -m "fix(dictionary): refreshDict 真正生效 + admin 写操作后失效 useDict 缓存

- 原 subs/notify 是死代码 (从不注册回调), 改用 SWR mutate 通知挂载组件
- admin 字典页新增/编辑/启停/批量后调用 refreshDict, 其他页面下拉即时刷新
- 跨标签页广播不做, 已知限制写入维护文档"
```

---

### Task 9: 删除合同详情页幽灵 `useDict("PAYMENT_METHOD")` 死代码

**Files:**
- Modify: `app/(app)/contracts/[id]/page.tsx`(:179,:428,可能还有 useDict import)

**Interfaces:**
- Consumes: `PAYMENT_METHOD_MAP`(lib/enum-maps.ts,覆盖全部 4 个合法 code)。
- Produces: 无接口变化;渲染结果不变(zod 约束 paymentMethod 只会是 4 个枚举值之一,`?? v` 兜底未知值)。

- [ ] **Step 1: 确认 useDict 在该文件的全部使用点**

Run: `grep -n "useDict" "app/(app)/contracts/[id]/page.tsx"`
Expected: 只有 :179 一处调用 + import 行(若还有其他类目调用,保留 import)。

- [ ] **Step 2: 删除死代码**

(a) 删除 :179:

```ts
  const paymentMethod = useDict("PAYMENT_METHOD");
```

(b) :428 替换:

```tsx
            { title: "付款方式", dataIndex: "paymentMethod", render: (v) => PAYMENT_METHOD_MAP[v as string] ?? v },
```

(c) 若 Step 1 确认无其他 useDict 调用,从 import 中移除 useDict。

- [ ] **Step 3: 验证**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/contracts/[id]/page.tsx"
git commit -m "fix(contracts): 删除合同详情页幽灵 useDict(\"PAYMENT_METHOD\") 死代码

类目名不存在 (正确名 CONTRACT_PAYMENT_METHOD), 永远返回空数组;
PAYMENT_METHOD_MAP 已覆盖全部 4 个枚举值, 直接用作唯一映射"
```

---

### Task 10: 字典种子双源合一

**Files:**
- Create: `scripts/shared/dict-defs.ts`
- Modify: `prisma/seed.ts`(dictDefs :79-217 替换为 import)
- Modify: `scripts/shared/seed-dicts.ts`(本地 DICT_DEFS :13-136 替换为 import)

**Interfaces:**
- Consumes: 无。
- Produces: `scripts/shared/dict-defs.ts` 导出 `type DictDef = { category: string; code: string; label: string; sort: number }` 与 `DICT_DEFS: readonly DictDef[]`。内容 = 现 `prisma/seed.ts` dictDefs **去掉 CUSTOMER_STATUS 5 条**(已下线且无运行时消费方,已 grep 确认),**保留 PERSONNEL_CERT_TYPE**(预留给人员证书模块,不在 16 类白名单,经 legacy `?category=` 分支可读);SERVICE_TYPE 以 seed.ts 的 10 条为准(与 `SERVICE_TYPE_MAP` 一致),seed-dicts.ts 的 6 条漂移 label 与 PROJECT_STATUS 7 条随之消除。

- [ ] **Step 1: 新建唯一定义源**

`scripts/shared/dict-defs.ts`:

```ts
/**
 * 数据字典唯一定义源 (单点真理)
 * 消费方: prisma/seed.ts (开发全量 seed) 与 scripts/shared/seed-dicts.ts (生产轻量 seed)
 * 注意:
 *   - 16 类白名单见 lib/dictionary-categories.ts; 新增类目需同步 3 处:
 *     lib/dictionary-categories.ts + lib/dict-domain.ts + 本文件
 *   - PERSONNEL_CERT_TYPE 不在白名单 (预留给人员证书模块), 仅经 legacy ?category= 分支可读
 *   - CUSTOMER_STATUS 已下线 (v0.5.0), PROJECT_STATUS 从未进白名单, 均不再 seed
 */
export type DictDef = { category: string; code: string; label: string; sort: number };

export const DICT_DEFS: readonly DictDef[] = [
  // 服务类型 (label 与 lib/enum-maps.ts SERVICE_TYPE_MAP 一致)
  { category: "SERVICE_TYPE", code: "SAFETY_CONSULT", label: "管理咨询", sort: 1 },
  { category: "SERVICE_TYPE", code: "SAFETY_TRAIN", label: "宣传教育培训", sort: 2 },
  { category: "SERVICE_TYPE", code: "HAZARD_ANA", label: "安全隐患排查", sort: 3 },
  { category: "SERVICE_TYPE", code: "EMERGENCY_PLAN", label: "应急预案/演练", sort: 4 },
  { category: "SERVICE_TYPE", code: "EVALUATION", label: "安全评估", sort: 5 },
  { category: "SERVICE_TYPE", code: "SYS_BUILDING", label: "安全体系建设", sort: 6 },
  { category: "SERVICE_TYPE", code: "RESIDENT", label: "派驻托管服务", sort: 7 },
  { category: "SERVICE_TYPE", code: "SURVEY", label: "普查核验服务", sort: 8 },
  { category: "SERVICE_TYPE", code: "STANDARDIZATION", label: "标准化体系创建/换证", sort: 9 },
  { category: "SERVICE_TYPE", code: "OTHER", label: "其他", sort: 99 },
  // 客户类型
  { category: "CUSTOMER_TYPE", code: "ENTERPRISE", label: "企业", sort: 1 },
  { category: "CUSTOMER_TYPE", code: "GOV", label: "政府", sort: 2 },
  { category: "CUSTOMER_TYPE", code: "OTHER", label: "其他", sort: 3 },
  // 客户规模
  { category: "CUSTOMER_SCALE", code: "LARGE", label: "大型", sort: 1 },
  { category: "CUSTOMER_SCALE", code: "MEDIUM", label: "中型", sort: 2 },
  { category: "CUSTOMER_SCALE", code: "SMALL", label: "小型", sort: 3 },
  { category: "CUSTOMER_SCALE", code: "MICRO", label: "微型", sort: 4 },
  // 客户行业
  { category: "CUSTOMER_INDUSTRY", code: "MANUFACTURING", label: "制造业", sort: 1 },
  { category: "CUSTOMER_INDUSTRY", code: "CHEMICAL", label: "化工", sort: 2 },
  { category: "CUSTOMER_INDUSTRY", code: "CONSTRUCTION", label: "建筑/房地产", sort: 3 },
  { category: "CUSTOMER_INDUSTRY", code: "ENERGY", label: "能源/电力", sort: 4 },
  { category: "CUSTOMER_INDUSTRY", code: "MINING", label: "矿山", sort: 5 },
  { category: "CUSTOMER_INDUSTRY", code: "TRANSPORTATION", label: "交通运输", sort: 6 },
  { category: "CUSTOMER_INDUSTRY", code: "WAREHOUSING", label: "仓储物流", sort: 7 },
  { category: "CUSTOMER_INDUSTRY", code: "COMMERCE", label: "商业贸易", sort: 8 },
  { category: "CUSTOMER_INDUSTRY", code: "FINANCE", label: "金融", sort: 9 },
  { category: "CUSTOMER_INDUSTRY", code: "HEALTHCARE", label: "医疗医药", sort: 10 },
  { category: "CUSTOMER_INDUSTRY", code: "EDUCATION", label: "教育", sort: 11 },
  { category: "CUSTOMER_INDUSTRY", code: "IT", label: "信息技术", sort: 12 },
  { category: "CUSTOMER_INDUSTRY", code: "GOVERNMENT", label: "政府/事业单位", sort: 13 },
  { category: "CUSTOMER_INDUSTRY", code: "SERVICES", label: "服务业", sort: 14 },
  { category: "CUSTOMER_INDUSTRY", code: "AGRICULTURE", label: "农林牧渔", sort: 15 },
  { category: "CUSTOMER_INDUSTRY", code: "F_AND_B", label: "餐饮酒店", sort: 16 },
  { category: "CUSTOMER_INDUSTRY", code: "OTHER", label: "其他", sort: 99 },
  // 客户来源
  { category: "CUSTOMER_SOURCE", code: "EXHIBITION", label: "展会", sort: 1 },
  { category: "CUSTOMER_SOURCE", code: "REFERRAL", label: "客户介绍/转介绍", sort: 2 },
  { category: "CUSTOMER_SOURCE", code: "WEBSITE", label: "官网咨询", sort: 3 },
  { category: "CUSTOMER_SOURCE", code: "PHONE", label: "电话来访", sort: 4 },
  { category: "CUSTOMER_SOURCE", code: "COLD_VISIT", label: "主动拜访", sort: 5 },
  { category: "CUSTOMER_SOURCE", code: "BIDDING", label: "招投标", sort: 6 },
  { category: "CUSTOMER_SOURCE", code: "PARTNER", label: "合作伙伴", sort: 7 },
  { category: "CUSTOMER_SOURCE", code: "MEDIA", label: "媒体广告", sort: 8 },
  { category: "CUSTOMER_SOURCE", code: "SOCIAL_MEDIA", label: "社交媒体", sort: 9 },
  { category: "CUSTOMER_SOURCE", code: "GOV_REFERRAL", label: "政府推荐", sort: 10 },
  { category: "CUSTOMER_SOURCE", code: "REPEAT", label: "老客户", sort: 11 },
  { category: "CUSTOMER_SOURCE", code: "OTHER", label: "其他", sort: 99 },
  // 收款方式
  { category: "PAYMENT_RECEIVE_METHOD", code: "BANK_TRANSFER", label: "银行转账", sort: 1 },
  { category: "PAYMENT_RECEIVE_METHOD", code: "CHECK", label: "支票", sort: 2 },
  { category: "PAYMENT_RECEIVE_METHOD", code: "CASH", label: "现金", sort: 3 },
  { category: "PAYMENT_RECEIVE_METHOD", code: "WECHAT", label: "微信", sort: 4 },
  { category: "PAYMENT_RECEIVE_METHOD", code: "ALIPAY", label: "支付宝", sort: 5 },
  { category: "PAYMENT_RECEIVE_METHOD", code: "OTHER", label: "其他", sort: 99 },
  // 跟进方式 / 结果
  { category: "FOLLOW_METHOD", code: "VISIT", label: "上门拜访", sort: 1 },
  { category: "FOLLOW_METHOD", code: "CALL", label: "电话", sort: 2 },
  { category: "FOLLOW_METHOD", code: "WECHAT", label: "微信", sort: 3 },
  { category: "FOLLOW_METHOD", code: "EMAIL", label: "邮件", sort: 4 },
  { category: "FOLLOW_METHOD", code: "OTHER", label: "其他", sort: 99 },
  { category: "FOLLOW_RESULT", code: "INTENT", label: "有意向", sort: 1 },
  { category: "FOLLOW_RESULT", code: "NO_INTENT", label: "无意向", sort: 2 },
  { category: "FOLLOW_RESULT", code: "PENDING", label: "待定", sort: 3 },
  { category: "FOLLOW_RESULT", code: "SIGNED", label: "已签约", sort: 4 },
  // 人员证书类型 - 标书素材库 v1 (不在 16 类白名单, 预留)
  { category: "PERSONNEL_CERT_TYPE", code: "REGISTERED_SAFETY_ENGINEER", label: "注册安全工程师", sort: 10 },
  { category: "PERSONNEL_CERT_TYPE", code: "SAFETY_EVALUATOR", label: "安全评价师", sort: 20 },
  { category: "PERSONNEL_CERT_TYPE", code: "EMERGENCY_RESCUER", label: "应急救援员", sort: 30 },
  { category: "PERSONNEL_CERT_TYPE", code: "TRAINING_INSTRUCTOR", label: "培训师资", sort: 40 },
  { category: "PERSONNEL_CERT_TYPE", code: "SPECIAL_OPERATION", label: "特种作业操作证", sort: 50 },
  { category: "PERSONNEL_CERT_TYPE", code: "OTHER", label: "其他", sort: 999 },
  // === 以下状态机/枚举约束类目: 展示数据, 约束真源是 types/enums.ts + 状态机代码 ===
  // 合同状态机
  { category: "CONTRACT_STATUS", code: "DRAFT", label: "草稿", sort: 1 },
  { category: "CONTRACT_STATUS", code: "ACTIVE", label: "生效中", sort: 2 },
  { category: "CONTRACT_STATUS", code: "CLOSED", label: "已完结", sort: 3 },
  // 发票类型
  { category: "INVOICE_TYPE", code: "VAT_SPECIAL", label: "增值税专用发票", sort: 1 },
  { category: "INVOICE_TYPE", code: "VAT_GENERAL", label: "增值税普通发票", sort: 2 },
  { category: "INVOICE_TYPE", code: "VAT_ELECTRONIC", label: "增值税电子专票", sort: 3 },
  { category: "INVOICE_TYPE", code: "ELEC_NORMAL", label: "电子普通发票", sort: 4 },
  // 开票状态机
  { category: "INVOICE_STATUS", code: "DRAFT", label: "草稿", sort: 1 },
  { category: "INVOICE_STATUS", code: "PENDING_FINANCE", label: "待财务审核", sort: 2 },
  { category: "INVOICE_STATUS", code: "ISSUED", label: "已开票", sort: 3 },
  { category: "INVOICE_STATUS", code: "REJECTED", label: "已驳回", sort: 4 },
  { category: "INVOICE_STATUS", code: "VOIDED", label: "已作废", sort: 5 },
  { category: "INVOICE_STATUS", code: "RED_FLUSHED", label: "已红冲", sort: 6 },
  // 回款状态机
  { category: "PAYMENT_STATUS", code: "PLANNED", label: "计划中", sort: 1 },
  { category: "PAYMENT_STATUS", code: "CONFIRMED", label: "已确认", sort: 2 },
  { category: "PAYMENT_STATUS", code: "RECONCILED", label: "已对账", sort: 3 },
  { category: "PAYMENT_STATUS", code: "REFUNDED", label: "已退款", sort: 4 },
  { category: "PAYMENT_STATUS", code: "CANCELLED", label: "已取消", sort: 5 },
  // 合同付款方式
  { category: "CONTRACT_PAYMENT_METHOD", code: "LUMP_SUM", label: "一次性", sort: 1 },
  { category: "CONTRACT_PAYMENT_METHOD", code: "BY_PHASE", label: "按阶段", sort: 2 },
  { category: "CONTRACT_PAYMENT_METHOD", code: "BY_MONTH", label: "按月", sort: 3 },
  { category: "CONTRACT_PAYMENT_METHOD", code: "BY_QUARTER", label: "按季", sort: 4 },
  // 审批动作
  { category: "REVIEW_ACTION", code: "SUBMIT", label: "提交审批", sort: 1 },
  { category: "REVIEW_ACTION", code: "APPROVE", label: "批准", sort: 2 },
  { category: "REVIEW_ACTION", code: "REJECT", label: "驳回", sort: 3 },
  { category: "REVIEW_ACTION", code: "WITHDRAW", label: "撤回", sort: 4 },
  { category: "REVIEW_ACTION", code: "EXECUTE", label: "开始执行", sort: 5 },
  { category: "REVIEW_ACTION", code: "SUSPEND", label: "暂停", sort: 6 },
  { category: "REVIEW_ACTION", code: "RESUME", label: "恢复", sort: 7 },
  { category: "REVIEW_ACTION", code: "COMPLETE", label: "结清", sort: 8 },
  // 员工档案 - 最高学历 / 教育经历-学历
  { category: "EDUCATION_LEVEL", code: "HIGH_SCHOOL", label: "高中", sort: 1 },
  { category: "EDUCATION_LEVEL", code: "JUNIOR_COLLEGE", label: "大专", sort: 2 },
  { category: "EDUCATION_LEVEL", code: "BACHELOR", label: "本科", sort: 3 },
  { category: "EDUCATION_LEVEL", code: "MASTER", label: "硕士", sort: 4 },
  { category: "EDUCATION_LEVEL", code: "DOCTORATE", label: "博士", sort: 5 },
  { category: "EDUCATION_LEVEL", code: "OTHER", label: "其他", sort: 99 },
  // 员工档案 - 合同类型
  { category: "CONTRACT_TYPE", code: "LABOR", label: "劳动合同", sort: 1 },
  { category: "CONTRACT_TYPE", code: "SERVICE", label: "劳务合同", sort: 2 },
  { category: "CONTRACT_TYPE", code: "INTERNSHIP", label: "实习协议", sort: 3 },
  { category: "CONTRACT_TYPE", code: "OTHER", label: "其他", sort: 99 }
];
```

- [ ] **Step 2: prisma/seed.ts 改 import**

(a) import 区加:

```ts
import { DICT_DEFS } from "@/scripts/shared/dict-defs";
```

(b) 删除 `const dictDefs: Array<...> = [ ... ];`(:79-210),循环(:211-217)改为:

```ts
  for (const d of DICT_DEFS) {
    await prisma.dictionary.upsert({
      where: { category_code: { category: d.category, code: d.code } },
      update: { label: d.label, sort: d.sort },
      create: d
    });
  }
```

- [ ] **Step 3: scripts/shared/seed-dicts.ts 改 import**

(a) 头部注释(:2-9)替换:

```ts
/**
 * 生产轻量字典 seed (不污染空库)。唯一定义源 = scripts/shared/dict-defs.ts,
 * 与 prisma/seed.ts 共用, 不再双份维护。
 *
 * 用法:
 *   pnpm seed-dicts
 */
```

(b) 删除本地 `type DictDef` 与 `const DICT_DEFS`(:13-136),import 区加:

```ts
import { DICT_DEFS } from "./dict-defs";
```

(main 内 upsert 循环不变,`create: { ...d, isActive: true }` 保留。)

- [ ] **Step 4: 验证**

Run: `npm run typecheck && npm run lint`
Expected: 0 errors。
再确认定义一致:`npx tsx -e "import { DICT_DEFS } from './scripts/shared/dict-defs'; const cats = new Set(DICT_DEFS.map(d => d.category)); console.log(DICT_DEFS.length, [...cats].sort().join(','))"`
Expected: 输出 107 条、17 个类目且不含 CUSTOMER_STATUS/PROJECT_STATUS。

- [ ] **Step 5: Commit**

```bash
git add scripts/shared/dict-defs.ts prisma/seed.ts scripts/shared/seed-dicts.ts
git commit -m "refactor(dictionary): 字典种子双源合一到 scripts/shared/dict-defs.ts

- 消除 seed.ts 与 seed-dicts.ts 漂移 (SERVICE_TYPE label / 类目集不一致)
- 移除已下线的 CUSTOMER_STATUS 与从未进白名单的 PROJECT_STATUS
- 保留 PERSONNEL_CERT_TYPE (人员证书模块预留, 不在 16 类白名单)"
```

---

### Task 11: 文档同步

**Files:**
- Modify: `docs/user/USER_MANUAL.md`(§3.2 角色矩阵表,§12.2 角色编辑,§12.4 字典)
- Modify: `docs/architecture/DESIGN-v3.md`(§3.2 权限矩阵)
- Modify: `docs/ops/dictionary-maintenance.md`(类目表/只读标注/缓存限制/加类目清单)

**Interfaces:**
- Consumes: Task 1 矩阵、Task 2 角色页只读、Task 3/4 字典只读、Task 8 缓存限制、Task 10 种子单源。
- Produces: 文档与代码一致。

- [ ] **Step 1: USER_MANUAL §3.2 角色矩阵表**

定位 `docs/user/USER_MANUAL.md` §3(:102-152)的模块矩阵表,把 EXPERT、OPS 两行更新为(其余行不动):

- EXPERT 行:开票"只读+导出"、回款"只读+导出"、催款"只读",客户/合同保持"本人 CRU+导出"
- OPS 行:客户"只读+导出"(原 CRU),合同/发票/回款"只读+导出",部门 CRUD、公告 CRUD 不变
- §3 设计注记里把"EXPERT 与 SALES 同"的描述改为:"EXPERT 类似 SALES 跟进本人客户/合同(行级隔离),但钱相关只读(发票/回款只读+导出,催款只读)"

- [ ] **Step 2: USER_MANUAL §12.2 角色页只读说明**

把"角色权限可在后台编辑、≤2s 生效"的描述替换为:

> 角色权限由代码矩阵 (`lib/permissions.ts`) 定义,`/admin/roles` 页面只读展示 5 个内置角色的当前矩阵;不支持后台编辑与自定义角色。调整权限需修改代码并发布,发布后用 `pnpm seed-roles` 同步数据库展示副本。

- [ ] **Step 3: USER_MANUAL §12.4 字典只读类目**

补充说明:

> 其中 9 个类目(客户类型/客户规模/合同付款方式/发票类型/收款方式/审批动作/合同状态/开票状态/回款状态)的 code 由系统枚举或状态机约束,页面只读展示(锁标识),不可新增/编辑/启停;其余类目管理员可正常维护,修改后其他页面下拉即时生效(跨标签页需刷新)。

- [ ] **Step 4: DESIGN-v3 §3.2 权限矩阵**

同步 EXPERT/OPS 两行(同 Step 1 内容),并把"角色权限后续允许后台编辑"之类的表述改为"硬编码矩阵为唯一运行时真源,/admin/roles 只读展示"。

- [ ] **Step 5: dictionary-maintenance.md 全面更正**

`docs/ops/dictionary-maintenance.md`:

(a) 类目表:删 PROJECT_STATUS 行,补 EDUCATION_LEVEL/CONTRACT_TYPE 行,总数改 16 类;9 个枚举约束类目标注"只读(code 由 types/enums.ts/状态机约束)",注明 PERSONNEL_CERT_TYPE 不在白名单(预留)。
(b) "新增类目要改 N 处"清单更新为 3 处:`lib/dictionary-categories.ts` + `lib/dict-domain.ts` + `scripts/shared/dict-defs.ts`(种子已合一)。
(c) 缓存说明:`useDict` 模块级缓存,admin 页写操作后自动 `refreshDict` 失效同标签页缓存;**跨标签页不广播,其他已打开的标签页需手动刷新**(已知限制)。
(d) 状态机硬编码迁移 TODO 段落(:86-94)更新状态:已改为"只读防误导"方案落地,彻底字典化仍是未来项。

- [ ] **Step 6: Commit**

```bash
git add docs/user/USER_MANUAL.md docs/architecture/DESIGN-v3.md docs/ops/dictionary-maintenance.md
git commit -m "docs(permissions,dictionary): 同步权限矩阵与字典只读/种子单源/缓存限制"
```

---

### Task 12: 全量验证

**Files:** 无改动,仅验证。

- [ ] **Step 1: 静态检查 + 单测**

Run: `npm run typecheck && npm run lint && npm test`
Expected: 全绿。

- [ ] **Step 2: 受影响面回归确认**

- `tests/permissions.test.ts`、`tests/menu-filter.test.ts`(菜单门控未变,应无需修改)、`tests/e2e/04-ops-flow.spec.ts`(OPS 只读场景,未依赖 OPS 写客户,应不受影响)——如 CI 环境可跑,执行 `npm run test:e2e` 重点确认 04 号 spec;本地无法跑则在 PR 描述里标注待 CI 验证。
- 手动冒烟(可选):admin 登录 `/admin/dictionaries`,确认 9 个只读类目显示锁标+禁写、7 个可写类目改 label 后客户表单下拉即时刷新;`/admin/roles` 无新建/编辑入口,矩阵 14 资源完整展示。

- [ ] **Step 3: 发布闭环(需用户确认后执行)**

按 AGENTS.md:更新 CHANGELOG.md 与 README 最近更新 → `npm version patch` → commit/push → `scripts/prod/deploy.sh` 或 `scripts/prod/remote-deploy.sh` 部署。生产部署后在服务器补跑 `pnpm seed-roles`(同步 DB 展示副本)。
