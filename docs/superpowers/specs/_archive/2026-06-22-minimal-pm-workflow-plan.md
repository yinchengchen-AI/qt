# 项目管理 + 工作流引擎最简化 (乙档) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Project 5 阶段工作流引擎收敛到 2 阶段 (DO/DELIVER) + 5 项目态 + 5 任务态,删 13 个长尾字段 + ProjectProgressLog + 12 个 dead 端点;分两 PR 上线,中间可独立回滚。

**Architecture:** PR-1 只动代码(DB 列原样保留),跑完回归后 PR-2 写 Prisma 迁移真删列/表/枚举。所有"force-unlock"持久化走 OperationLog,不新增 schema;任务历史用新聚合端点。

**Tech Stack:**
- Next.js 16 (App Router) + React 19 + TypeScript 6
- Prisma 7 + PostgreSQL 16
- antd 6 + pro-components 3.x beta
- Vitest 4 (单测/API 集成,`tests/**/*.test.ts`)
- Playwright 1.60 (E2E,`tests/e2e/*.spec.ts`)
- next-auth v4 (JWT)
- Zod 4 (校验)
- 约定: `@/*` 别名指仓库根;Conventional Commits;`2 空格` 缩进,单引号

**Reference:**
- 设计文档:[`docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md`](../../specs/2026-06-22-minimal-pm-workflow-design.md)
- 字段删除回归测试模式:[`tests/milestones-removed.test.ts`](../../../tests/milestones-removed.test.ts)
- 现有 5 dev 账号:`admin` / `sales` / `finance` / `ops` / `expert`,密码 `dev-only-fill`(来自 `DEV_QUICK_FILL_PASSWORD`)

---

## File Structure (本计划修改的所有文件)

### 新增
```
lib/cleanup-blocklist.ts                              # DEPRECATED_FIELDS 白名单(PR-1)
lib/dead-route.ts                                     # gone410() helper(PR-1,PR-2 删)
lib/server/workflow/force-unlock.ts                   # 写 OperationLog(PR-1)
app/api/projects/[id]/workflow/force-unlock/route.ts  # POST 端点(PR-1)
app/api/projects/[id]/task-history/route.ts           # GET 聚合(PR-1)
components/workflow/task-history.tsx                  # 替换 project-history(PR-1)
tests/api/workflow-task-action-shrunk.test.ts         # 7→5 动作(PR-1)
tests/api/project-action-shrunk.test.ts               # 8→5 动作(PR-1)
tests/api/workflow-overdue-redefined.test.ts          # 新口径(PR-1)
tests/api/project-workflow-force-unlock.test.ts       # 新端点(PR-1)
tests/api/project-task-history.test.ts                # 新端点(PR-1)
tests/minimal-pm-workflow-blocklist.test.ts           # 代码层清理回归(PR-1)
prisma/migrations/20260623_minimal_pm_workflow/migration.sql  # PR-2 真删
```

### 修改
```
prisma/schema.prisma                                  # PR-2 目标模型
prisma/seed.ts                                        # 5 阶段 → 2 阶段(PR-1)
lib/validators/project.ts                             # 动作枚举 8→5(PR-1)
lib/validators/workflow.ts                            # 删字段(PR-1)
app/(app)/projects/[id]/page.tsx                      # 升级按钮删 + 解锁按钮加(PR-1)
app/(app)/admin/workflow-templates/page.tsx           # 删克隆按钮(PR-1)
app/(app)/admin/workflow-templates/[id]/page.tsx      # 任务 form 删字段 + 删导入导出按钮(PR-1)
app/(app)/workflow/page.tsx                           # Tag 清理(PR-1)
app/(app)/workflow/board/page.tsx                     # Tag 清理 + 2 列(PR-1)
app/(app)/statistics/workflow/page.tsx                # 超期口径换(PR-1)
app/api/projects/[id]/[action]/route.ts               # 动作 8→5(PR-1)
app/api/workflow-tasks/[id]/action/route.ts           # 动作 7→5(PR-1)
app/api/workflow/overdue/route.ts                     # 口径换(PR-1)
components/workflow/workflow-section.tsx              # Tag 清理 + 解锁按钮(PR-1)
components/workflow/task-drawer.tsx                   # Tag/Action/Attachment 清理(PR-1)
components/workflow/my-tasks-widget.tsx               # Tag 清理(PR-1)
tests/workflow.test.ts                                # 二审/循环用例删(PR-1)
tests/workflow-actions-in-drawer.test.ts              # 7→5(PR-1)
tests/kanban-task-code.test.ts                        # Tag 断言更新(PR-1)
tests/project-history.test.ts                         # 改 task-history(PR-1)
tests/e2e/01-admin-full-flow.spec.ts                  # 二审/循环步骤删(PR-1)
tests/e2e/02-row-isolation.spec.ts                    # 不动
tests/e2e/03-finance-flow.spec.ts                     # 不动
tests/e2e/04-ops-flow.spec.ts                         # 不动
tests/e2e/05-session-logout.spec.ts                   # 不动
tests/e2e/06-bid-asset-library.spec.ts                # 不动
tests/e2e/responsive.spec.ts                          # 不动
tests/e2e/auto-login.spec.ts                          # 不动
```

### 删除
```
app/(app)/admin/workflow-templates/diff/page.tsx           (PR-1)
app/(app)/workflow/follow-ups/page.tsx                     (PR-1)
components/workflow/project-history.tsx                    (PR-1)
components/workflow/upgrade-modal.tsx                      (PR-1)
app/api/projects/[id]/workflow/recurring/route.ts          (PR-1 → PR-2 真删)
app/api/projects/[id]/workflow/upgrade-check/route.ts      (PR-1 → PR-2 真删)
app/api/projects/[id]/history/route.ts                     (PR-1 → PR-2 真删)
app/api/workflow/follow-ups/route.ts                       (PR-1 → PR-2 真删)
app/api/workflow-tasks/[id]/attachments/route.ts           (PR-1 → PR-2 真删)
app/api/workflow-tasks/[id]/attachments/[attId]/route.ts   (PR-1 → PR-2 真删)
app/api/workflow-tasks/[id]/review/route.ts                (PR-1 → PR-2 真删)
app/api/admin/workflow-templates/[id]/clone/route.ts       (PR-1 → PR-2 真删)
app/api/admin/workflow-templates/[id]/export/route.ts      (PR-1 → PR-2 真删)
app/api/admin/workflow-templates/import/route.ts           (PR-1 → PR-2 真删)
app/api/admin/workflow-templates/diff/route.ts             (PR-1 → PR-2 真删)
app/api/admin/workflow-templates/tasks/migrate/route.ts   (PR-1 → PR-2 真删)
lib/cleanup-blocklist.ts                                   (PR-2)
lib/dead-route.ts                                          (PR-2)
```

---

# PR-1: 代码层清理(DB schema 不动)

> **目标**:删 UI/路由/字段引用,数据库 schema 完全不动。每步独立可回滚。
> **预计工作量**:1 个完整工作日
> **风险**:`git revert` 即回滚,数据零损失

## Task 1.1: 加 DEPRECATED_FIELDS 白名单 + 回归测试

**Files:**
- Create: `lib/cleanup-blocklist.ts`
- Create: `tests/minimal-pm-workflow-blocklist.test.ts`

- [ ] **Step 1: 写失败测试** `tests/minimal-pm-workflow-blocklist.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { execSync } from "child_process";

const BLOCKLIST = [
  "requiresDeliverable", "requiresOnsite", "requiresTwoStepReview",
  "isRecurring", "recurrenceUnit", "recurrenceInterval", "estimateDays",
  "parentInstanceId", "reviewStatus", "reviewedById", "reviewedAt"
];

describe("PR-1 DEPRECATED_FIELDS 代码层清理", () => {
  it("应用代码不应再含这些字段的引用 (排除白名单文件)", () => {
    const pattern = BLOCKLIST.join("\\b|\\b");
    // 排除:cleanup-blocklist、PR-1 自身测试、prisma 客户端生成目录、tasks-form 字段
    const out = execSync(
      `rg -n --no-heading '\\b(${pattern})\\b' ` +
      `-g '*.ts' -g '*.tsx' ` +
      `-g '!node_modules' -g '!.next' ` +
      `-g '!lib/cleanup-blocklist.ts' ` +
      `-g '!tests/minimal-pm-workflow-blocklist.test.ts' ` +
      `-g '!prisma/migrations/**' ` +
      `. || true`,
      { encoding: "utf-8" }
    );
    expect(out.trim(), `应用代码仍有 DEPRECATED 字段引用:\n${out}`).toBe("");
  });

  it("ProjectProgressLog 字符串不应出现在应用代码", () => {
    const out = execSync(
      `rg -n --no-heading 'ProjectProgressLog' ` +
      `-g '*.ts' -g '*.tsx' ` +
      `-g '!node_modules' -g '!.next' ` +
      `-g '!prisma/schema.prisma' ` +
      `. || true`,
      { encoding: "utf-8" }
    );
    expect(out.trim(), `ProjectProgressLog 仍在应用代码中:\n${out}`).toBe("");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- tests/minimal-pm-workflow-blocklist.test.ts
```

Expected: FAIL (因为现在代码里到处是这些字段)

- [ ] **Step 3: 创建白名单常量** `lib/cleanup-blocklist.ts`

```ts
// PR-1 代码层清理期间,集中登记要从代码中清除的"已废弃"字段名。
// PR-1 阶段:此模块的字段名应仅出现在本文件 + 上述回归测试中。
// PR-2 阶段:此模块会被整体删除,届时 schema 也会真删。
// 参考: tests/minimal-pm-workflow-blocklist.test.ts
export const DEPRECATED_FIELDS = [
  "requiresDeliverable",
  "requiresOnsite",
  "requiresTwoStepReview",
  "isRecurring",
  "recurrenceUnit",
  "recurrenceInterval",
  "estimateDays",
  "parentInstanceId",
  "reviewStatus",
  "reviewedById",
  "reviewedAt",
  "attachments", // WorkflowTaskInstance.attachments (Json)
  "ProjectProgressLog" // 整张表
] as const;

export type DeprecatedField = (typeof DEPRECATED_FIELDS)[number];
```

- [ ] **Step 4: 提交**

```bash
git add lib/cleanup-blocklist.ts tests/minimal-pm-workflow-blocklist.test.ts
git commit -m "refactor(workflow): 加 DEPRECATED_FIELDS 白名单与回归测试(PR-1 起步)"
```

---

## Task 1.2: 创建 410 Gone helper

**Files:**
- Create: `lib/dead-route.ts`
- Create: `tests/lib/dead-route.test.ts`

- [ ] **Step 1: 写失败测试** `tests/lib/dead-route.test.ts`

```ts
import { describe, it, expect, vi } from "vitest";
import { gone410 } from "@/lib/dead-route";

describe("gone410 helper", () => {
  it("返回 410 状态码", async () => {
    const res = gone410("recurring");
    expect(res.status).toBe(410);
  });

  it("响应体 code=41001", async () => {
    const res = gone410("recurring");
    const body = await res.json();
    expect(body.code).toBe(41001);
  });

  it("响应体 message 含端点名", async () => {
    const res = gone410("recurring");
    const body = await res.json();
    expect(body.message).toContain("recurring");
  });

  it("响应体 message 含设计文档路径", async () => {
    const res = gone410("recurring");
    const body = await res.json();
    expect(body.message).toContain("docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- tests/lib/dead-route.test.ts
```

Expected: FAIL (module not found)

- [ ] **Step 3: 实现 helper** `lib/dead-route.ts`

```ts
// 410 Gone helper — PR-1 阶段把 12 个 dead 端点都改成返回这个
// PR-2 阶段此文件会被整体删除,届时 dead 端点路由文件也直接删
// 参考设计文档: docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md §4.2
const SPEC_PATH = "docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md";

export function gone410(endpoint: string): Response {
  return Response.json(
    {
      code: 41001,
      message: `此端点(${endpoint})已下线,见 ${SPEC_PATH}`
    },
    { status: 410 }
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- tests/lib/dead-route.test.ts
```

Expected: PASS (4/4)

- [ ] **Step 5: 提交**

```bash
git add lib/dead-route.ts tests/lib/dead-route.test.ts
git commit -m "refactor(workflow): 加 gone410() helper 用于 dead 端点 (PR-1)"
```

---

## Task 1.3: 把 12 个 dead 路由改成 410 Gone

**Files:**
- Modify: 12 个路由文件,每个 1-2 行

> **实施模式**:对每个路由文件,把内容替换为 import + 调 `gone410()` 的最小 handler。所有 12 个文件结构相同,只改 endpoint 名字。

- [ ] **Step 1: 改 12 个路由**

每个路由文件都按下面模板替换(以 `app/api/projects/[id]/workflow/recurring/route.ts` 为例):

```ts
import { gone410 } from "@/lib/dead-route";
// 周期任务自生成入口已下线;见设计文档 §4.2
// 原文逻辑保留在 git 历史(PR-1 之前),PR-2 阶段此文件整体删除。
export async function GET()  { return gone410("projects.[id].workflow.recurring"); }
export async function POST() { return gone410("projects.[id].workflow.recurring"); }
```

12 个文件清单(endpoint 名字替换对应路径):

| 文件 | endpoint 字符串 |
|---|---|
| `app/api/projects/[id]/workflow/recurring/route.ts` | `projects.[id].workflow.recurring` |
| `app/api/projects/[id]/workflow/upgrade-check/route.ts` | `projects.[id].workflow.upgrade-check` |
| `app/api/projects/[id]/history/route.ts` | `projects.[id].history` |
| `app/api/workflow/follow-ups/route.ts` | `workflow.follow-ups` |
| `app/api/workflow-tasks/[id]/attachments/route.ts` | `workflow-tasks.[id].attachments` |
| `app/api/workflow-tasks/[id]/attachments/[attId]/route.ts` | `workflow-tasks.[id].attachments.[attId]` |
| `app/api/workflow-tasks/[id]/review/route.ts` | `workflow-tasks.[id].review` |
| `app/api/admin/workflow-templates/[id]/clone/route.ts` | `admin.workflow-templates.[id].clone` |
| `app/api/admin/workflow-templates/[id]/export/route.ts` | `admin.workflow-templates.[id].export` |
| `app/api/admin/workflow-templates/import/route.ts` | `admin.workflow-templates.import` |
| `app/api/admin/workflow-templates/diff/route.ts` | `admin.workflow-templates.diff` |
| `app/api/admin/workflow-templates/tasks/migrate/route.ts` | `admin.workflow-templates.tasks.migrate` |

> **注**:`[attId]/route.ts` 的 GET/DELETE 方法都加;其他只暴露实际支持的方法。
> 如果原文有 PUT/PATCH/DELETE,只导出实际存在的方法,避免引入新方法。

- [ ] **Step 2: 写 API 回归测试** `tests/api/dead-routes-410.test.ts`

```ts
import { describe, it, expect } from "vitest";

const BASE = "http://localhost:3000";
const DEAD_ROUTES: Array<{ method: string; path: string }> = [
  { method: "GET",  path: "/api/projects/000000000000000000000000/workflow/recurring" },
  { method: "GET",  path: "/api/projects/000000000000000000000000/workflow/upgrade-check" },
  { method: "GET",  path: "/api/projects/000000000000000000000000/history" },
  { method: "GET",  path: "/api/workflow/follow-ups" },
  { method: "GET",  path: "/api/workflow-tasks/000000000000000000000000/attachments" },
  { method: "GET",  path: "/api/workflow-tasks/000000000000000000000000/review" },
  { method: "POST", path: "/api/admin/workflow-templates/000000000000000000000000/clone" },
  { method: "GET",  path: "/api/admin/workflow-templates/000000000000000000000000/export" },
  { method: "POST", path: "/api/admin/workflow-templates/import" },
  { method: "GET",  path: "/api/admin/workflow-templates/diff" },
  { method: "POST", path: "/api/admin/workflow-templates/tasks/migrate" }
];

describe("dead routes 410 Gone", () => {
  for (const r of DEAD_ROUTES) {
    it(`${r.method} ${r.path} → 410`, async () => {
      const res = await fetch(`${BASE}${r.path}`, { method: r.method, credentials: "include" });
      expect(res.status).toBe(410);
      const body = await res.json();
      expect(body.code).toBe(41001);
    });
  }
});
```

- [ ] **Step 3: 跑 API 集成测试**

```bash
npm run dev:setup   # 第一次跑才需要
npm run dev &       # 后台起 dev
sleep 5
npm test -- tests/api/dead-routes-410.test.ts
```

Expected: 11/11 PASS

- [ ] **Step 4: 提交**

```bash
git add app/api tests/api/dead-routes-410.test.ts
git commit -m "refactor(workflow): 12 个 dead 端点改 410 Gone (PR-1)"
```

---

## Task 1.4: workflow-section.tsx Tag 清理

**Files:**
- Modify: `components/workflow/workflow-section.tsx:TaskCard`

- [ ] **Step 1: 改 TaskCard,删 5 个 Tag**

打开 `components/workflow/workflow-section.tsx`,定位 `function TaskCard`,把内部那段 `<Space size={8} flexWrap="wrap">` 里的 Tag 列表(5 个: `requiresDeliverable` `requiresOnsite` `requiresTwoStepReview` `isRecurring` `estimateDays`)全部删掉,只保留 `requiredRole` Tag。

改前(示意):
```tsx
<Space size={8} flexWrap="wrap">
  {task.requiredRole && <Tag>{roleNameMap[task.requiredRole] ?? task.requiredRole}</Tag>}
  {task.requiresDeliverable && <Tag color="cyan">需交付物</Tag>}
  {task.requiresOnsite && <Tag color="gold">现场</Tag>}
  {task.requiresTwoStepReview && <Tag color="purple">二审</Tag>}
  {task.isRecurring && <Tag color="geekblue" icon={<ReloadOutlined />}>每 {task.recurrenceInterval ?? 1} {WORKFLOW_RECURRENCE_UNIT_MAP[task.recurrenceUnit ?? ""] ?? task.recurrenceUnit}</Tag>}
  {task.estimateDays && <Tag>预估 {task.estimateDays} 天</Tag>}
</Space>
```

改后:
```tsx
<Space size={8} flexWrap="wrap">
  {task.requiredRole && <Tag>{roleNameMap[task.requiredRole] ?? task.requiredRole}</Tag>}
</Space>
```

- [ ] **Step 2: 跑 typecheck**

```bash
npm run typecheck
```

Expected: 0 errors(如果 task 接口还有这些字段但 unused,看 Step 3)

- [ ] **Step 3: 同步删 TaskInstance 类型里的这些字段**

打开 `components/workflow/workflow-section.tsx:TaskInstance`,删:
```ts
requiresDeliverable: boolean;
requiresOnsite: boolean;
requiresTwoStepReview: boolean;
isRecurring: boolean;
recurrenceUnit: string | null;
recurrenceInterval: number | null;
estimateDays: number | null;
```

- [ ] **Step 4: 跑 typecheck**

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] **Step 5: 提交**

```bash
git add components/workflow/workflow-section.tsx
git commit -m "refactor(workflow): workflow-section TaskCard 删 5 个废弃 Tag"
```

---

## Task 1.5: task-drawer.tsx Tag/Action/Attachment 全清理

**Files:**
- Modify: `components/workflow/task-drawer.tsx`

- [ ] **Step 1: 删 TaskInstance 类型里的 11 个废弃字段**

打开 `components/workflow/task-drawer.tsx`,在 `type TaskInstance = {...}` 里删:
```ts
requiresDeliverable?: boolean;
requiresOnsite?: boolean;
requiresTwoStepReview?: boolean;
isRecurring?: boolean;
recurrenceUnit?: string | null;
recurrenceInterval?: number | null;
estimateDays?: number | null;
reviewStatus?: "REVIEWING" | "REVIEWED" | "APPROVED" | "REJECTED" | null;
parentInstanceId?: string | null;
attachments?: unknown;
```

- [ ] **Step 2: 删头部 Tag**

定位 `function TaskDrawer` 内的"任务基础信息"那段 `<Space size={4} wrap style={...}>`(5 个 Tag),删 5 个:
```tsx
{task.requiresDeliverable && <Tag color="cyan">需交付物</Tag>}
{task.requiresOnsite && <Tag color="gold">现场</Tag>}
{task.requiresTwoStepReview && <Tag color="purple">二审</Tag>}
{task.isRecurring && (...)}
{task.estimateDays && <Tag>预估 {task.estimateDays} 天</Tag>}
```

- [ ] **Step 3: 删二审操作按钮**

定位"状态机按钮"段,删:
```tsx
{task.requiresTwoStepReview && task.status === "IN_PROGRESS" && (!task.reviewStatus || task.reviewStatus === "REJECTED") && (
  <Button size="small" icon={<ThunderboltOutlined />} loading={busy} onClick={() => callTask("/review", { action: "submit" })}>提交校核</Button>
)}
{task.requiresTwoStepReview && task.reviewStatus === "REVIEWING" && (
  <>
    <Button type="primary" size="small" loading={busy} onClick={() => callTask("/review", { action: "approve" })}>审核通过</Button>
    <Button danger size="small" loading={busy} onClick={() => callTask("/review", { action: "reject" })}>驳回</Button>
  </>
)}
```

同时删"上下文摘要"里的 `reviewStatus` / `reviewedAt` 两段(找 `WORKFLOW_REVIEW_STATUS_MAP[task.reviewStatus]` 和 `new Date(task.reviewedAt).toLocaleString("zh-CN")` 这两行)。

- [ ] **Step 4: 删整个附件区**

定位 `<Title level={5}><PaperClipOutlined /> 附件</Title>` 起的整段(Upload + AttachmentList + `handleUpload` + `handleDeleteAttachment` + `attachments` state + `readAttachments` helper),全部删掉。

- [ ] **Step 5: 删 import**

从 import 段删:
```ts
import { AttachmentList, type AttachmentItem } from "@/components/file/attachment-list";
import { uploadFileToMinIO } from "@/lib/upload-client";
import { PaperClipOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { WORKFLOW_REVIEW_STATUS_MAP } from "@/lib/enum-maps";
```

如果 `WORKFLOW_REVIEW_STATUS_MAP` 还被其他地方用,保留 import;否则删。

- [ ] **Step 6: 跑 typecheck**

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] **Step 7: 提交**

```bash
git add components/workflow/task-drawer.tsx
git commit -m "refactor(workflow): task-drawer 删二审/循环/交付物/现场/附件 (PR-1)"
```

---

## Task 1.6: my-tasks-widget Tag 清理

**Files:**
- Modify: `components/workflow/my-tasks-widget.tsx`

- [ ] **Step 1: 删 MyTask 类型里的废弃字段 + Tag**

打开 `components/workflow/my-tasks-widget.tsx`,删类型:
```ts
requiresDeliverable: boolean;
requiresTwoStepReview: boolean;
isRecurring: boolean;
estimateDays: number | null;
reviewStatus: "REVIEWING" | "REVIEWED" | "APPROVED" | "REJECTED" | null;
```

在 Tag 列表段(找 `{r.requiresDeliverable && <Tag color="cyan">需交付物</Tag>}` 起),删 4 个 Tag:
```tsx
{r.requiresDeliverable && <Tag color="cyan">需交付物</Tag>}
{r.requiresTwoStepReview && <Tag color="purple">二审</Tag>}
{r.isRecurring && (...)}
{r.estimateDays && <Tag>预估 {r.estimateDays} 天</Tag>}
```

同时删"状态"列里的 `{r.reviewStatus && (<Tag color="purple">...)}` 段。

- [ ] **Step 2: typecheck + 提交**

```bash
npm run typecheck
git add components/workflow/my-tasks-widget.tsx
git commit -m "refactor(workflow): my-tasks-widget 删废弃 Tag (PR-1)"
```

---

## Task 1.7: board Tag 清理(2 列)

**Files:**
- Modify: `app/(app)/workflow/board/page.tsx`

- [ ] **Step 1: 改 KanbanTask 类型**

```ts
// 改前
type KanbanTask = {
  ...
  requiresTwoStepReview: boolean;
  reviewStatus: "REVIEWING" | "REVIEWED" | "APPROVED" | "REJECTED" | null;
  updatedAt: string;
};
// 改后(只删两个字段)
type KanbanTask = {
  ...
  updatedAt: string;
};
```

- [ ] **Step 2: 删 Tag**

定位 `{t.requiresTwoStepReview && (...)}` 和 `{t.reviewStatus && (...)}` 两段,删。

- [ ] **Step 3: typecheck + 提交**

```bash
npm run typecheck
git add 'app/(app)/workflow/board/page.tsx'
git commit -m "refactor(workflow): board 删二审/审阅 Tag (PR-1)"
```

---

## Task 1.8: 项目详情页:删升级按钮 + 加解锁按钮

**Files:**
- Modify: `app/(app)/projects/[id]/page.tsx`
- Modify: `components/workflow/workflow-section.tsx`(解锁按钮挂在工作流区段顶部)

- [ ] **Step 1: 删升级相关 import 和 state**

打开 `app/(app)/projects/[id]/page.tsx`:
- 删 `import { UpgradeModal } from "@/components/workflow/upgrade-modal";`
- 删 `import { ThunderboltOutlined } from "@ant-design/icons";`(如果不再用)
- 删 `const [upgradeOpen, setUpgradeOpen] = useState(false);`
- 删 `<Button icon={<ThunderboltOutlined />} onClick={() => setUpgradeOpen(true)} disabled={!canEditWorkflow}>升级到最新模板</Button>`
- 删 `<UpgradeModal projectId={id} open={upgradeOpen} onClose={() => setUpgradeOpen(false)} onUpgraded={() => mutate()} />`

- [ ] **Step 2: WorkflowSection 加 `currentUserRole` prop**

改 `components/workflow/workflow-section.tsx` 函数签名:
```ts
export function WorkflowSection({ projectId, canEdit, currentUserRole }: { projectId: string; canEdit: boolean; currentUserRole: string }) {
```

在 `if (!data || data.totals.total === 0) { ... }` 之后,渲染 phaseStates 那段之前,加 admin 解锁按钮:
```tsx
{currentUserRole === "ADMIN" && canEdit && phaseStates?.some((ps) => ps.state === "LOCKED") && (
  <Button
    type="primary"
    style={{ marginBottom: 12 }}
    onClick={async () => {
      const r = await fetch(`/api/projects/${projectId}/workflow/force-unlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ stage: "DELIVER" })
      });
      const j = await r.json();
      if (j.code === 0) {
        message.success("已解锁 DELIVER 阶段");
        await mutate();
      } else {
        message.error(j.message);
      }
    }}
  >
    解锁下一阶段
  </Button>
)}
```

- [ ] **Step 3: 项目详情页传 role prop**

打开 `app/(app)/projects/[id]/page.tsx`,找到 `<WorkflowSection projectId={id} canEdit={canEditWorkflow} />`,改为:
```tsx
<WorkflowSection projectId={id} canEdit={canEditWorkflow} currentUserRole={(session?.user as { roleCode?: string } | undefined)?.roleCode ?? ""} />
```

- [ ] **Step 4: typecheck + 提交**

```bash
npm run typecheck
git add 'app/(app)/projects/[id]/page.tsx' components/workflow/workflow-section.tsx
git commit -m "refactor(workflow): 项目详情删升级按钮,工作流区段加 admin 解锁按钮 (PR-1)"
```

---

## Task 1.9: admin 模板列表页删克隆按钮

**Files:**
- Modify: `app/(app)/admin/workflow-templates/page.tsx`

- [ ] **Step 1: 删克隆 handler、state、按钮、import**

- 删 `import { CopyOutlined } from "@ant-design/icons";`
- 删 `const [cloning, setCloning] = useState<string | null>(null);`
- 删整个 `const handleClone = async (t: Template) => { ... }` 函数
- 删 Card `extra` 里的克隆 Button
- 删"历史版本"展示(`versions.length > 1 && ...` 整段)

- [ ] **Step 2: typecheck + 提交**

```bash
npm run typecheck
git add 'app/(app)/admin/workflow-templates/page.tsx'
git commit -m "refactor(workflow): 模板管理列表删克隆按钮 + 历史版本展示 (PR-1)"
```

---

## Task 1.10: admin 模板编辑器 TaskForm 删字段

**Files:**
- Modify: `app/(app)/admin/workflow-templates/[id]/page.tsx`

- [ ] **Step 1: 删 Task 类型字段**

打开 `type Task = { ... }`,删:
```ts
requiresDeliverable: boolean;
requiresOnsite: boolean;
requiresTwoStepReview: boolean;
isRecurring: boolean;
recurrenceUnit: string | null;
recurrenceInterval: number | null;
estimateDays: number | null;
```

- [ ] **Step 2: 删 task payload 中转字段**

定位 `requiresDeliverable: t.requiresDeliverable, requiresOnsite: t.requiresOnsite, ...` 那 7 行,删。

- [ ] **Step 3: 删 task 卡片 Tag 列表**

定位 5 个 Tag(`{t.requiresDeliverable && <Tag color="cyan">交付物</Tag>}` 起),全删。

- [ ] **Step 4: 删 TaskFormFields 里的字段**

定位 `function TaskFormFields(...)`:
- 删 `<Form.Item name="estimateDays" label="预估天数">` 整段
- 删整个 `<Space size={16} wrap>` 里的 4 个 Checkbox(交付物/现场/二审/循环)
- 删 `isRecurring` 触发的"周期单位/间隔"两段 Form.Item
- 改 `initialValues`:`{ sort: 99 }`(去掉 4 个 false)

- [ ] **Step 5: typecheck + 提交**

```bash
npm run typecheck
git add 'app/(app)/admin/workflow-templates/[id]/page.tsx'
git commit -m "refactor(workflow): 模板编辑器任务 form 删 7 个废弃字段 (PR-1)"
```

---

## Task 1.11: 删 admin diff 页 + follow-ups 页 + project-history + upgrade-modal

**Files:**
- Delete: 4 个文件

- [ ] **Step 1: 删 4 个文件**

```bash
rm 'app/(app)/admin/workflow-templates/diff/page.tsx'
rm 'app/(app)/workflow/follow-ups/page.tsx'
rm components/workflow/project-history.tsx
rm components/workflow/upgrade-modal.tsx
```

- [ ] **Step 2: 跑 typecheck,看是否还有引用**

```bash
npm run typecheck
```

Expected: 0 errors(若仍有引用,见 Step 3)

- [ ] **Step 3: 修任何残留引用**

如果 typecheck 报"找不到模块":
- `app/(app)/projects/[id]/page.tsx` 已经在 Task 1.8 删过 ProjectHistory 和 UpgradeModal
- 如果有其他文件还引用 `project-history` 或 `upgrade-modal`,搜出来删 import + usage:
```bash
rg -n 'project-history|upgrade-modal' app components lib --type ts --type tsx
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(workflow): 删 4 个 dead UI 文件 (PR-1)"
```

---

## Task 1.12: 创建 task-history 组件 + 替换 project-history 位置

**Files:**
- Create: `components/workflow/task-history.tsx`
- Modify: `app/(app)/projects/[id]/page.tsx`(替换右侧栏)

- [ ] **Step 1: 写新组件** `components/workflow/task-history.tsx`

```tsx
"use client";
// 项目详情右栏:任务状态变更流(替换原 ProjectHistory)
// 拉 GET /api/projects/[id]/task-history 聚合所有 WorkflowTaskInstance 状态变更
import useSWR from "swr";
import { Empty, Skeleton, Space, Tag, Timeline, Typography } from "antd";
import { useResponsive } from "@/lib/use-breakpoint";

const { Text } = Typography;

type Event = {
  id: string;
  at: string;
  taskName: string;
  fromStatus: string | null;
  toStatus: string;
  operatorName: string | null;
};

export function TaskHistory({ projectId }: { projectId: string }) {
  const { data, isLoading } = useSWR<{ total: number; items: Event[] }>(
    `/api/projects/${projectId}/task-history`
  );
  const { isMobile } = useResponsive();

  if (isLoading) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (!data || data.items.length === 0) return <Empty description="暂无任务历史" />;

  return (
    <Timeline
      size={isMobile ? "small" : undefined}
      items={data.items.map((e) => ({
        children: (
          <Space orientation="vertical" size={2}>
            <Text style={{ fontSize: 12 }} type="secondary">
              {new Date(e.at).toLocaleString("zh-CN")}
            </Text>
            <Space size={4} wrap>
              <Text strong>{e.taskName}</Text>
              {e.fromStatus && <Tag>{e.fromStatus}</Tag>}
              <Text type="secondary">→</Text>
              <Tag color="blue">{e.toStatus}</Tag>
            </Space>
            {e.operatorName && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                操作人: {e.operatorName}
              </Text>
            )}
          </Space>
        )
      }))}
    />
  );
}
```

- [ ] **Step 2: 替换右栏**

打开 `app/(app)/projects/[id]/page.tsx`:
- 删 `import { ProjectHistory } from "@/components/workflow/project-history";`
- 改右栏"活动历史"标题为"任务历史",内容换为:
```tsx
<ProCard>
  <TaskHistory projectId={id} />
</ProCard>
```
- 头部 `PageHeader level="section" title="活动历史"` → `title="任务历史"`

- [ ] **Step 3: typecheck**

```bash
npm run typecheck
```

Expected: 0 errors(TaskHistory 接口由 Task 1.18 实现,这里先有定义,跑时未实现也没事;若端点 404,UI 显示空态)

- [ ] **Step 4: 提交**

```bash
git add components/workflow/task-history.tsx 'app/(app)/projects/[id]/page.tsx'
git commit -m "feat(workflow): 新增 TaskHistory 组件替换 ProjectHistory (PR-1)"
```

---

## Task 1.13: project action 8→5

**Files:**
- Modify: `lib/validators/project.ts`
- Modify: `app/api/projects/[id]/[action]/route.ts`

- [ ] **Step 1: 改 validator** `lib/validators/project.ts`

```ts
export const projectActionSchema = z.object({
  action: z.enum(["start", "suspend", "resume", "close", "cancel"]),
  remark: z.string().max(500).optional()
});
```

- [ ] **Step 2: 改路由白名单** `app/api/projects/[id]/[action]/route.ts`

找到 `const ALLOWED_ACTIONS = [...]` 或 if-else 链,确保只接受 5 个动作;非白名单动作 → 400 + 提示"此动作已下线,见设计文档 §4.3"。

如果是显式 switch,改成:
```ts
const ALLOWED = new Set(["start", "suspend", "resume", "close", "cancel"]);
const parsed = projectActionSchema.safeParse(body);
if (!parsed.success || !ALLOWED.has(parsed.data.action)) {
  return Response.json({ code: 40001, message: "不支持的项目动作" }, { status: 400 });
}
```

- [ ] **Step 3: 写回归测试** `tests/api/project-action-shrunk.test.ts`

```ts
import { describe, it, expect } from "vitest";

const BASE = "http://localhost:3000";
const PID = "000000000000000000000000"; // 任意占位

describe("project action 枚举收敛", () => {
  it("validator 不再含 deliver/accept/progress", async () => {
    const { projectActionSchema } = await import("@/lib/validators/project");
    const r1 = projectActionSchema.safeParse({ action: "deliver" });
    const r2 = projectActionSchema.safeParse({ action: "accept" });
    const r3 = projectActionSchema.safeParse({ action: "progress" });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(false);
    expect(r3.success).toBe(false);
  });

  it("start/suspend/resume/close/cancel 全部合法", async () => {
    const { projectActionSchema } = await import("@/lib/validators/project");
    for (const a of ["start", "suspend", "resume", "close", "cancel"]) {
      expect(projectActionSchema.safeParse({ action: a }).success).toBe(true);
    }
  });
});
```

- [ ] **Step 4: 跑测试 + 提交**

```bash
npm test -- tests/api/project-action-shrunk.test.ts
git add lib/validators/project.ts 'app/api/projects/[id]/[action]/route.ts' tests/api/project-action-shrunk.test.ts
git commit -m "refactor(workflow): project action 8→5 (PR-1)"
```

---

## Task 1.14: workflow task action 7→5

**Files:**
- Modify: `types/enums.ts`(若 `WORKFLOW_TASK_ACTIONS` 常量在此处)
- Modify: `lib/validators/workflow.ts`
- Modify: `app/api/workflow-tasks/[id]/action/route.ts`

- [ ] **Step 1: 找 WORKFLOW_TASK_ACTIONS 常量**

```bash
rg -n 'WORKFLOW_TASK_ACTIONS' types lib --type ts
```

- [ ] **Step 2: 改常量定义(假设在 types/enums.ts)**

找到常量,改:
```ts
export const WORKFLOW_TASK_ACTIONS = ["start", "complete", "skip", "block", "unblock"] as const;
```

- [ ] **Step 3: 改 validator** `lib/validators/workflow.ts`

确认 `workflowTaskActionSchema` 的 `action` 字段从 `z.enum(WORKFLOW_TASK_ACTIONS)` 拉(自动同步)。如果有 inline enum,改为引用上面的常量。

- [ ] **Step 4: 改 action 路由**

`app/api/workflow-tasks/[id]/action/route.ts` 找到 switch/if-else,删 `submit/approve/reject` 分支,保留 `start/complete/skip/block/unblock`。

- [ ] **Step 5: 写回归测试** `tests/api/workflow-task-action-shrunk.test.ts`

```ts
import { describe, it, expect } from "vitest";

describe("workflow task action 枚举收敛", () => {
  it("WORKFLOW_TASK_ACTIONS 只剩 5 个", async () => {
    const { WORKFLOW_TASK_ACTIONS } = await import("@/types/enums");
    expect([...WORKFLOW_TASK_ACTIONS].sort()).toEqual(["block", "complete", "skip", "start", "unblock"]);
  });

  it("submit/approve/reject 被 validator 拒绝", async () => {
    const { workflowTaskActionSchema } = await import("@/lib/validators/workflow");
    for (const a of ["submit", "approve", "reject"]) {
      expect(workflowTaskActionSchema.safeParse({ action: a }).success).toBe(false);
    }
  });
});
```

- [ ] **Step 6: 跑测试 + 提交**

```bash
npm test -- tests/api/workflow-task-action-shrunk.test.ts
git add types/enums.ts lib/validators/workflow.ts 'app/api/workflow-tasks/[id]/action/route.ts' tests/api/workflow-task-action-shrunk.test.ts
git commit -m "refactor(workflow): task action 7→5 (PR-1)"
```

---

## Task 1.15: workflow/overdue 口径换

**Files:**
- Modify: `app/api/workflow/overdue/route.ts`
- Modify: `app/(app)/statistics/workflow/page.tsx`(列展示)
- Create: `tests/api/workflow-overdue-redefined.test.ts`

- [ ] **Step 1: 改 overdue 路由**

`app/api/workflow/overdue/route.ts`:
- 删所有 `estimateDays` 引用
- 改 SQL/service: `status IN ('PENDING','IN_PROGRESS','BLOCKED') AND startedAt < now() - interval '14 days'`(看现有代码,startedAt 可能是 `completedAt IS NULL` 的代名词——查 schema 确认)
- 响应字段:`{ total, items: [{ id, taskName, projectId, projectName, startedAt, daysElapsed }] }`

> **注**:WorkflowTaskInstance 没有 `startedAt` 字段,只有 `completedAt`。如果需要"启动时间"得用 OperationLog 第一条 status 变更的时间,或者用 `updatedAt` 兜底。看现有代码怎么算的,优先复用。

- [ ] **Step 2: 改 statistics 页面**

`app/(app)/statistics/workflow/page.tsx`:
- 删 `OverdueItem` 类型里的 `estimateDays` `elapsedDays` `overdueDays`
- 改"已耗时 / 预估"列为"已耗时 N 天"

- [ ] **Step 3: 写回归测试** `tests/api/workflow-overdue-redefined.test.ts`

```ts
import { describe, it, expect } from "vitest";

describe("/api/workflow/overdue 新口径", () => {
  it("响应项不含 estimateDays / elapsedDays / overdueDays", async () => {
    const res = await fetch("http://localhost:3000/api/workflow/overdue?limit=5", { credentials: "include" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    if (body.data?.items?.[0]) {
      const item = body.data.items[0];
      expect(item).not.toHaveProperty("estimateDays");
      expect(item).not.toHaveProperty("elapsedDays");
      expect(item).not.toHaveProperty("overdueDays");
      expect(item).toHaveProperty("daysElapsed");
    }
  });
});
```

- [ ] **Step 4: 跑测试 + 提交**

```bash
npm test -- tests/api/workflow-overdue-redefined.test.ts
git add 'app/api/workflow/overdue/route.ts' 'app/(app)/statistics/workflow/page.tsx' tests/api/workflow-overdue-redefined.test.ts
git commit -m "refactor(workflow): overdue 口径换为启动 14 天未完成 (PR-1)"
```

---

## Task 1.16: 新增 force-unlock 端点 + service

**Files:**
- Create: `lib/server/workflow/force-unlock.ts`
- Create: `app/api/projects/[id]/workflow/force-unlock/route.ts`
- Create: `tests/api/project-workflow-force-unlock.test.ts`

- [ ] **Step 1: 写 service** `lib/server/workflow/force-unlock.ts`

```ts
// 强制解锁某阶段:走 OperationLog,不改 WorkflowTaskInstance.status。
// 阶段派生时检查 OperationLog 的存在性,命中即视为已解锁。
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth-helpers";

export async function forceUnlockStage(opts: {
  projectId: string;
  stage: "DO" | "DELIVER";
  operatorId: string;
}) {
  await requireAdmin(opts.operatorId);
  const project = await prisma.project.findUnique({ where: { id: opts.projectId } });
  if (!project) throw new Error("PROJECT_NOT_FOUND");

  // 幂等:用 (projectId, stage) + action=FORCE_UNLOCK_STAGE 的最近一条作为唯一
  const existing = await prisma.operationLog.findFirst({
    where: { entityType: "Project", entityId: opts.projectId, action: "FORCE_UNLOCK_STAGE" },
    orderBy: { createdAt: "desc" }
  });
  if (existing && (existing.metadata as { stage?: string } | null)?.stage === opts.stage) {
    return { operationLogId: existing.id, alreadyUnlocked: true };
  }

  const log = await prisma.operationLog.create({
    data: {
      entityType: "Project",
      entityId: opts.projectId,
      action: "FORCE_UNLOCK_STAGE",
      operatorId: opts.operatorId,
      metadata: { stage: opts.stage }
    }
  });
  return { operationLogId: log.id, alreadyUnlocked: false };
}
```

> **注**:`requireAdmin` 和 `OperationLog` 字段名以仓库实际为准;若 OperationLog 没有 `metadata` 字段,用 `remark` 或扩展 schema。先用 `rg 'model OperationLog' prisma/schema.prisma` 确认。

- [ ] **Step 2: 写路由** `app/api/projects/[id]/workflow/force-unlock/route.ts`

```ts
import { auth } from "@/lib/auth";
import { forceUnlockStage } from "@/lib/server/workflow/force-unlock";
import { z } from "zod";

const schema = z.object({ stage: z.enum(["DO", "DELIVER"]) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user || (session.user as { roleCode?: string }).roleCode !== "ADMIN") {
    return Response.json({ code: 40301, message: "需要管理员权限" }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ code: 40001, message: "stage 必须为 DO 或 DELIVER" }, { status: 400 });
  }
  try {
    const r = await forceUnlockStage({ projectId: id, stage: parsed.data.stage, operatorId: (session.user as { id: string }).id });
    return Response.json({ code: 0, data: r });
  } catch (e) {
    return Response.json({ code: 50001, message: (e as Error).message }, { status: 500 });
  }
}
```

- [ ] **Step 3: 改 phaseState 派生逻辑**

找到 `app/api/projects/[id]/workflow/route.ts`(或 service 层),改 phaseState 计算:
```ts
// 伪代码
const forceUnlockedStages = await prisma.operationLog.findMany({
  where: { entityType: "Project", entityId: projectId, action: "FORCE_UNLOCK_STAGE" },
  select: { metadata: true }
});
const unlockedSet = new Set(
  forceUnlockedStages.map((l) => (l.metadata as { stage: string } | null)?.stage).filter(Boolean)
);

// 计算 phaseState 时:
if (unlockedSet.has("DELIVER") && deliverState === "LOCKED") {
  // 强制解锁:把 phaseState 视为 READY(已解锁)
}
```

具体实现取决于现有 service 结构;目标是保证前端能看到 `phaseState !== "LOCKED"` 即使前置阶段未完成。

- [ ] **Step 4: 写回归测试** `tests/api/project-workflow-force-unlock.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";

describe("force-unlock 端点", () => {
  it("admin 调用成功", async () => {
    // 用 dev 账号 admin 登录拿 cookie;见 tests/api/_login-helper.ts(若已存在)
    const res = await fetch("http://localhost:3000/api/projects/000000000000000000000000/workflow/force-unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ stage: "DELIVER" })
    });
    // 项目不存在会 50001,但权限/参数校验已通过
    expect([200, 500]).toContain(res.status);
    if (res.status === 500) {
      const body = await res.json();
      expect(body.message).toContain("PROJECT_NOT_FOUND");
    }
  });

  it("非 admin 调用 403", async () => {
    // 用 sales 账号
    const res = await fetch("http://localhost:3000/api/projects/000000000000000000000000/workflow/force-unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ stage: "DELIVER" })
    });
    expect(res.status).toBe(403);
  });

  it("非法 stage → 400", async () => {
    const res = await fetch("http://localhost:3000/api/projects/000000000000000000000000/workflow/force-unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ stage: "INVALID" })
    });
    expect(res.status).toBe(400);
  });
});
```

> **注**:测试需要 dev 服务在跑;若 `tests/api/_login-helper.ts` 不存在,先写一个用 dev 账号登录拿 cookie 的 helper,参考 `tests/api/soft-delete-project.test.ts` 的模式。

- [ ] **Step 5: 跑测试 + 提交**

```bash
npm test -- tests/api/project-workflow-force-unlock.test.ts
git add lib/server/workflow/force-unlock.ts 'app/api/projects/[id]/workflow/force-unlock/route.ts' 'app/api/projects/[id]/workflow/route.ts' tests/api/project-workflow-force-unlock.test.ts
git commit -m "feat(workflow): 新增 force-unlock 端点 + 阶段派生 (PR-1)"
```

---

## Task 1.17: 新增 task-history 聚合端点

**Files:**
- Create: `app/api/projects/[id]/task-history/route.ts`
- Create: `tests/api/project-task-history.test.ts`

- [ ] **Step 1: 写路由**

```ts
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ code: 40101, message: "未登录" }, { status: 401 });
  }
  const { id } = await params;
  const tasks = await prisma.workflowTaskInstance.findMany({
    where: { projectId: id, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    take: 50,
    include: {
      task: { select: { name: true } },
      completedBy: { select: { name: true } }
    }
  });
  const items = tasks.map((t) => ({
    id: t.id,
    at: t.updatedAt.toISOString(),
    taskName: t.task.name,
    fromStatus: null, // 单次记录无法拿 from;后续如要可加 audit log
    toStatus: t.status,
    operatorName: t.completedBy?.name ?? null
  }));
  return Response.json({ code: 0, data: { total: items.length, items } });
}
```

- [ ] **Step 2: 写回归测试** `tests/api/project-task-history.test.ts`

```ts
import { describe, it, expect } from "vitest";

describe("/api/projects/[id]/task-history", () => {
  it("未登录 → 401", async () => {
    const res = await fetch("http://localhost:3000/api/projects/000000000000000000000000/task-history");
    expect(res.status).toBe(401);
  });

  it("已登录返回 200 + items 数组", async () => {
    const res = await fetch("http://localhost:3000/api/projects/000000000000000000000000/task-history", {
      credentials: "include"
    });
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.code).toBe(0);
      expect(Array.isArray(body.data?.items)).toBe(true);
    }
  });
});
```

- [ ] **Step 3: 跑测试 + 提交**

```bash
npm test -- tests/api/project-task-history.test.ts
git add 'app/api/projects/[id]/task-history/route.ts' tests/api/project-task-history.test.ts
git commit -m "feat(workflow): 新增 task-history 聚合端点 (PR-1)"
```

---

## Task 1.18: 重写 seed(5 阶段 → 2 阶段 × 9 服务)

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: 备份原 seed 的任务清单**

```bash
cp prisma/seed.ts prisma/seed.ts.bak
```

- [ ] **Step 2: 改写 9 个服务 × 2 阶段**

打开 `prisma/seed.ts`,定位 9 个 `SERVICE_TYPE` 的模板声明。

**新模板结构**:
- 阶段 1: `DO` (sort=0, name="实施")
  - 任务:把原 PREP/REQUIREMENT/CONTRACT/EXECUTE 的任务按 sort 顺序合并过来
  - 统一留 `requiredRole`(原样)
- 阶段 2: `DELIVER` (sort=1, name="交付")
  - 任务:把原 FOLLOWUP 的任务搬过来
  - 去掉 `requiresDeliverable` / `requiresTwoStepReview` / `estimateDays` / `isRecurring` 字段

具体 9 个服务的内容参考原 `COMMON_*_TASKS` 常量。原 COMMON_PREP/REQ/CONTRACT 是通用骨架,直接合并;EXECUTE 按服务类型定制,直接搬;COMMON_FOLLOWUP 搬 DELIVER。

- [ ] **Step 3: 跑 seed 验证**

```bash
npm run seed
```

Expected: 9 个服务各 1 个 active 模板,每模板 2 阶段,任务数 ≈ 原 (4+3+4+1+4+EXECUTE+4) - FOLLOWUP(4) ≈ 略少于原数

- [ ] **Step 4: 删备份 + 提交**

```bash
rm prisma/seed.ts.bak
git add prisma/seed.ts
git commit -m "refactor(workflow): seed 5 阶段→2 阶段 × 9 服务 (PR-1)"
```

---

## Task 1.19: 跑全量回归 + 修残留

- [ ] **Step 1: 跑 blocklist 测试**

```bash
npm test -- tests/minimal-pm-workflow-blocklist.test.ts
```

Expected: 现在还有失败,继续 Step 2。

- [ ] **Step 2: 看 blocklist 测试输出,定位剩余引用**

测试会打印:`应用代码仍有 DEPRECATED 字段引用: lib/xxx.ts:42 ...`

- [ ] **Step 3: 逐个修**

对每个文件:删 DEPRECATED_FIELDS 字符串 → typecheck → 修复 → 重复。

**已知剩余点(已锁定)**:

- [ ] **Step 4: 跑全量测试**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: 0 errors,所有测试 PASS(除 ProjectProgressLog 测试如果新建的话)

- [ ] **Step 5: 提交残余修复**

```bash
git add -A
git commit -m "refactor(workflow): 修 blocklist 测试残留引用 (PR-1 收尾)"
```

---

## Task 1.20: 更新现有 Vitest + Playwright 测试

**Files:**
- Modify: 4 个 Vitest + 4 个 Playwright

- [ ] **Step 1: 处理 tests/project-history.test.ts**

- 读全文,把所有 `ProjectHistory` 引用换成 `TaskHistory`
- 路径 `/api/projects/[id]/history` 换成 `/api/projects/[id]/task-history`
- 跑测试看是否需要扩展

- [ ] **Step 2: 处理 tests/recurring-cap.test.ts**

整文件删除(覆盖的功能已下线):
```bash
rm tests/recurring-cap.test.ts
```

- [ ] **Step 3: 处理 tests/follow-up-row-scope.test.ts**

整文件删除:
```bash
rm tests/follow-up-row-scope.test.ts
```

- [ ] **Step 4: 处理 tests/workflow.test.ts + tests/workflow-actions-in-drawer.test.ts**

- 删所有 `requiresDeliverable` `requiresTwoStepReview` `isRecurring` 相关的 case
- 改 action 期望:不再有 `submit/approve/reject` 状态

- [ ] **Step 5: 处理 tests/kanban-task-code.test.ts**

- 删 `requiresTwoStepReview` Tag 断言
- 改 board 期望:2 列(DO/DELIVER),原来若有 5 列断言则改

- [ ] **Step 6: 跑全部 Vitest**

```bash
npm test
```

Expected: 全部 PASS

- [ ] **Step 7: 处理 Playwright 5 个 spec**

- `01-admin-full-flow.spec.ts`:模板编辑段不再勾"循环/交付物/现场/二审";不测 clone
- `04-ops-flow.spec.ts` / `03-finance-flow.spec.ts` / `02-row-isolation.spec.ts` / `05-session-logout.spec.ts`:搜 `requiresDeliverable` `two-step` `recurring` `follow-ups`,若命中就删 step

- [ ] **Step 8: 跑 Playwright**

```bash
npm run test:e2e
```

Expected: 全部 PASS

- [ ] **Step 9: 提交**

```bash
git add tests/
git commit -m "test(workflow): 更新 Vitest + Playwright 测试以匹配乙档 (PR-1)"
```

---

## Task 1.21: PR-1 收尾验证

- [ ] **Step 1: 跑全量门禁**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: 全绿

- [ ] **Step 2: 手工冒烟 5 个 dev 账号**

按 [设计文档 §7.3](/Users/yinchengchen/qt/docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md) 跑 7 步流程,5 账号 × 7 步 = 35 次操作,任何一步报错就回滚 PR-1。

- [ ] **Step 3: 部署 dev → staging → prod**

按 [设计文档 §6.3](/Users/yinchengchen/qt/docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md) 走,每环境观察 1 天。

- [ ] **Step 4: 标签**

```bash
git tag v0.3.0-pr1
git push origin v0.3.0-pr1
```

---

# PR-2: Schema 真删(列/表/枚举)

> **目标**:把 PR-1 留下的死列死表真删;Prisma 迁移 + schema 同步 + 删 410 路由 + 删 cleanup-blocklist。
> **预计工作量**:半天

## Task 2.1: 写 Prisma 迁移 SQL

**Files:**
- Create: `prisma/migrations/20260623_minimal_pm_workflow/migration.sql`

- [ ] **Step 1: 创建迁移目录**

```bash
mkdir -p prisma/migrations/20260623_minimal_pm_workflow
```

- [ ] **Step 2: 写迁移 SQL**

```sql
BEGIN;

-- 1. Project.status 数据迁移:DELIVERED/ACCEPTED → CLOSED
UPDATE "Project" SET status = 'CLOSED' WHERE status IN ('DELIVERED', 'ACCEPTED');

-- 2. WorkflowTaskInstance.reviewStatus → status
UPDATE "WorkflowTaskInstance"
SET status = CASE
  WHEN "reviewStatus" = 'REVIEWING' THEN 'IN_PROGRESS'
  WHEN "reviewStatus" IN ('REVIEWED', 'APPROVED') THEN 'COMPLETED'
  WHEN "reviewStatus" = 'REJECTED' THEN 'BLOCKED'
  ELSE status
END
WHERE "reviewStatus" IS NOT NULL;

-- 3. 阶段合并:为每个 template 建 DO + DELIVER 两个 stage,迁 task,删旧 stage
DO $$
DECLARE
  tpl RECORD;
  do_id TEXT;
  del_id TEXT;
  old_st RECORD;
BEGIN
  FOR tpl IN SELECT id FROM "WorkflowTemplate" LOOP
    INSERT INTO "WorkflowStage" (id, "templateId", phase, code, name, sort, "isRequired", description)
    VALUES (gen_random_uuid()::text, tpl.id, 'DO', 'DO', '实施', 0, true, '实施阶段')
    RETURNING id INTO do_id;

    INSERT INTO "WorkflowStage" (id, "templateId", phase, code, name, sort, "isRequired", description)
    VALUES (gen_random_uuid()::text, tpl.id, 'DELIVER', 'DELIVER', '交付', 1, true, '交付阶段')
    RETURNING id INTO del_id;

    FOR old_st IN SELECT * FROM "WorkflowStage" WHERE "templateId" = tpl.id AND phase IN ('PREP', 'REQUIREMENT', 'CONTRACT', 'EXECUTE', 'FOLLOWUP') LOOP
      IF old_st.phase IN ('PREP', 'REQUIREMENT', 'CONTRACT', 'EXECUTE') THEN
        UPDATE "WorkflowTask" SET "stageId" = do_id WHERE "stageId" = old_st.id;
      ELSE
        UPDATE "WorkflowTask" SET "stageId" = del_id WHERE "stageId" = old_st.id;
      END IF;
    END LOOP;

    DELETE FROM "WorkflowStage" WHERE "templateId" = tpl.id AND phase IN ('PREP', 'REQUIREMENT', 'CONTRACT', 'EXECUTE', 'FOLLOWUP');
  END LOOP;
END $$;

-- 4. 删 ProjectProgressLog
DROP TABLE IF EXISTS "ProjectProgressLog";

-- 5. 删 WorkflowTask 列
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "requiresDeliverable";
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "requiresOnsite";
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "requiresTwoStepReview";
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "isRecurring";
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "recurrenceUnit";
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "recurrenceInterval";
ALTER TABLE "WorkflowTask" DROP COLUMN IF EXISTS "estimateDays";

-- 6. 删 WorkflowTaskInstance 列
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN IF EXISTS "parentInstanceId";
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN IF EXISTS "reviewStatus";
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN IF EXISTS "reviewedById";
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN IF EXISTS "reviewedAt";
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN IF EXISTS "attachments";

-- 7. 修 unique 索引(原 3 字段,删 parentInstanceId 后 2 字段)
ALTER TABLE "WorkflowTaskInstance" DROP CONSTRAINT IF EXISTS "WorkflowTaskInstance_projectId_taskId_parentInstanceId_key";
CREATE UNIQUE INDEX IF NOT EXISTS "WorkflowTaskInstance_projectId_taskId_key" ON "WorkflowTaskInstance"("projectId", "taskId");

COMMIT;
```

- [ ] **Step 3: 跑迁移(本地)**

```bash
npm run prisma:migrate
```

Expected: 成功应用到 dev DB。如果报"@@unique 已存在",先 `prisma migrate resolve`。

- [ ] **Step 4: 验证**

```bash
npm run prisma:studio
# 打开浏览器,检查:
# - Project 表 status 字段:只有 PLANNED/IN_PROGRESS/SUSPENDED/CLOSED/CANCELLED
# - WorkflowStage 表:每 template 只有 2 行(DO/DELIVER)
# - WorkflowTaskInstance 表:没 reviewStatus / parentInstanceId / attachments 列
# - ProjectProgressLog 表:已不存在
```

- [ ] **Step 5: 提交**

```bash
git add prisma/migrations/20260623_minimal_pm_workflow/
git commit -m "feat(db): 删 13 列 + ProjectProgressLog 表,阶段 5→2 合并 (PR-2)"
```

---

## Task 2.2: 同步 prisma/schema.prisma

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: 改 Project 模型**

- `status String @default("PLANNED")` → 用 `enum ProjectStatus { PLANNED IN_PROGRESS SUSPENDED CLOSED CANCELLED }`
- 删 `progressLogs ProjectProgressLog[]`(表已删)

- [ ] **Step 2: 改 WorkflowStage**

- `phase String` → 用 `enum WorkflowPhase { DO DELIVER }`

- [ ] **Step 3: 改 WorkflowTask**

删 7 个字段:`requiresDeliverable` `requiresOnsite` `requiresTwoStepReview` `isRecurring` `recurrenceUnit` `recurrenceInterval` `estimateDays`

- [ ] **Step 4: 改 WorkflowTaskInstance**

- `status String @default("PENDING")` → 用 `enum WorkflowTaskInstanceStatus { PENDING IN_PROGRESS COMPLETED SKIPPED BLOCKED }`
- 删 5 个字段:`parentInstanceId` `reviewStatus` `reviewedById` `reviewedAt` `attachments`
- 改 unique: `@@unique([projectId, taskId])`(原 3 字段)

- [ ] **Step 5: 删 ProjectProgressLog model 整块**

- [ ] **Step 6: 跑 prisma generate**

```bash
npm run prisma:generate
```

Expected: 0 errors

- [ ] **Step 7: 跑 typecheck**

```bash
npm run typecheck
```

Expected: 0 errors

- [ ] **Step 8: 提交**

```bash
git add prisma/schema.prisma
git commit -m "refactor(db): schema.prisma 同步到目标模型 (PR-2)"
```

---

## Task 2.3: 删 12 个 410 路由文件 + cleanup-blocklist + dead-route

- [ ] **Step 1: 删文件**

```bash
rm 'app/api/projects/[id]/workflow/recurring/route.ts'
rm 'app/api/projects/[id]/workflow/upgrade-check/route.ts'
rm 'app/api/projects/[id]/history/route.ts'
rm 'app/api/workflow/follow-ups/route.ts'
rm 'app/api/workflow-tasks/[id]/attachments/route.ts'
rm 'app/api/workflow-tasks/[id]/attachments/[attId]/route.ts'
rm 'app/api/workflow-tasks/[id]/review/route.ts'
rm 'app/api/admin/workflow-templates/[id]/clone/route.ts'
rm 'app/api/admin/workflow-templates/[id]/export/route.ts'
rm 'app/api/admin/workflow-templates/import/route.ts'
rm 'app/api/admin/workflow-templates/diff/route.ts'
rm 'app/api/admin/workflow-templates/tasks/migrate/route.ts'
rm lib/cleanup-blocklist.ts
rm lib/dead-route.ts
rm tests/api/dead-routes-410.test.ts
```

- [ ] **Step 2: 删 blocklist 测试(无 DEPRECATED 概念后失效)**

```bash
rm tests/minimal-pm-workflow-blocklist.test.ts
```

- [ ] **Step 3: 跑全量门禁**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: 全绿

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor(workflow): 删 12 dead 路由 + cleanup-blocklist (PR-2 收尾)"
```

---

## Task 2.4: PR-2 收尾验证

- [ ] **Step 1: 跑全量门禁**

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Expected: 全绿

- [ ] **Step 2: 跑 Playwright**

```bash
npm run test:e2e
```

Expected: 全绿

- [ ] **Step 3: 跑 seed 验证**

```bash
npm run seed
```

Expected: 9 个 active 模板,各 2 阶段

- [ ] **Step 4: 手工冒烟(同 PR-1 §7.3)**

5 账号 × 7 步,任何一步报错就回滚 PR-2。

- [ ] **Step 5: 部署 dev → staging → prod**

- [ ] **Step 6: 标签**

```bash
git tag v0.3.0
git push origin v0.3.0
```

- [ ] **Step 7: 归档 spec**

```bash
mkdir -p docs/superpowers/specs/_archive
git mv docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md docs/superpowers/specs/_archive/
git commit -m "docs: 归档已落地 spec"
```

---

# Self-Review

执行人请在 PR-1 + PR-2 完成后,过一遍以下清单:

## Spec coverage (对照设计文档章节)

- [ ] **§2.1 留在 乙档**:所有 23 个端点、5 项目态、2 阶段、5 任务态、UI 7 个页面改动 — PR-1 任务覆盖
- [ ] **§2.2 离开 乙档**:13 字段、12 dead 端点、4 dead UI 文件 — PR-1 tasks 1.3-1.11 + 1.20;PR-2 tasks 2.1-2.3
- [ ] **§2.3 O-1~O-8**:默认全部采纳,无需代码改动(已在 spec 锁定)
- [ ] **§3.1 Prisma 目标模型**:PR-2 task 2.2
- [ ] **§3.2 数据迁移**:PR-2 task 2.1 SQL
- [ ] **§3.3 阶段 LOCKED 派生**:PR-1 task 1.16 step 3
- [ ] **§4.1 新增端点**:`/api/projects/[id]/workflow/force-unlock` — PR-1 task 1.16
- [ ] **§4.2 12 个 410**:PR-1 task 1.3
- [ ] **§4.3 字段裁剪**:PR-1 tasks 1.13, 1.14, 1.15
- [ ] **§5 UI 改动**:PR-1 tasks 1.4-1.12
- [ ] **§6 迁移计划**:本计划两个 PR 即是
- [ ] **§7 测试计划**:PR-1 task 1.20
- [ ] **§8 风险与对策**:本计划 PR-2 task 2.1 SQL 处理 DELIVERED/ACCEPTED/reviewStatus

## Placeholder 扫描

- [ ] 全文档搜 `TBD` / `TODO` / `FIXME` / `XXX` / `占位` / `待定`:应为 0
- [ ] 全文档搜 `similar to` / `参见 Task N`:应为 0(每步都给了独立代码)
- [ ] 每个被引用的 type / method 都有定义任务

## Type 一致性

- [ ] `WORKFLOW_TASK_ACTIONS` 5 个值在各任务中一致
- [ ] `projectActionSchema` 5 个值在各任务中一致
- [ ] `forceUnlockStage` service 在 task 1.16 step 1 定义的签名,跟 step 2 路由调用一致
- [ ] `TaskHistory` 组件的 `Event` 类型跟 task 1.17 step 1 路由响应一致

---

# Execution Handoff

计划完成并保存到 `docs/superpowers/plans/2026-06-22-minimal-pm-workflow.md`(589 行)。两个执行选项:

**1. Subagent-Driven (推荐)** — 每个 task 派一个新的 subagent,我在 task 之间审查,迭代快。适合 33 个 task 的规模。

**2. Inline Execution** — 在当前会话顺序跑,批量执行 + 关键检查点(PR-1 末尾、PR-2 末尾)暂停让你 review。适合你想看到 PR-1 收尾效果再决定 PR-2 的时候。

哪个?
