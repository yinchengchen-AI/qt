# 项目管理 + 工作流引擎 — 最简化 (乙档) 设计文档

| 项 | 值 |
|---|---|
| 日期 | 2026-06-22 |
| 状态 | 待 review |
| 范围 | 项目管理 (Project) + 工作流引擎 (Template / Stage / Task / TaskInstance) 收敛到 80% 业务场景,删长尾特性 |
| 目标版本 | qt-biz v0.3.0(与当前 main 一致) |
| 落地策略 | **II · 分阶段**(PR-1 代码层清理 / PR-2 schema 真删) |

## 1. 背景与目标

### 1.1 现状速记

- `Project` 7 态 + 11 字段,其中 `serviceScope` 真用,`budgetAmount` 已删
- `WorkflowTask` 字段集:`requiresDeliverable` `requiresOnsite` `requiresTwoStepReview` `isRecurring` `recurrenceUnit` `recurrenceInterval` `estimateDays` `requiredRole`
- `WorkflowTaskInstance` 字段集:`status`(5) `reviewStatus`(5) `attachments` `parentInstanceId` `reviewedById` `reviewedAt` `assigneeId` `remark` `completedAt` `completedById`
- 阶段 5 段固定:`PREP/REQUIREMENT/CONTRACT/EXECUTE/FOLLOWUP`
- 配套功能:项目进度日志 / 循环任务 endpoint / 升级到最新模板 / follow-up 列表 / 看板 / 二审 / 任务附件 / 模板 clone/import/export/diff/migrate
- 最近 4 次提交全是"删字段、删审计字段、删状态机"方向:用户已经在持续收口

### 1.2 目标

- **认知负担**:新人 1 小时内能画清楚 Project / Stage / Task 之间的关系
- **死代码清零**:从 grep 范围看到的 `requiresDeliverable` `requiresOnsite` `requiresTwoStepReview` `isRecurring` `recurrenceUnit` `recurrenceInterval` `estimateDays` `parentInstanceId` `reviewStatus` `reviewedById` `reviewedAt` `attachments` `ProjectProgressLog` 全部清掉(代码 + DB)
- **可演进**:留下来的是清晰的"项目 + 阶段 + 任务"三层,后续要加什么特性(比如再来一次交付物)有干净的位置可加

### 1.3 非目标

- 不动合同、发票、回款、客户模块
- 不动认证 / 权限 / 操作日志
- 不改 UI 设计系统(色板/字号/间距)
- 不引入新依赖

## 2. 范围

### 2.1 留在 乙档 (In)

**数据模型**
- `Project`: 7 字段(`id` `projectNo` `contractId` `name` `serviceScope` `managerUserId` `startDate` `endDate`)+ 5 态状态机 + `createdAt/updatedAt/createdById/updatedById/deletedAt`
- `WorkflowTemplate`: 仅保留 `serviceType` `name` `description` + 一对多 `WorkflowStage` + `(isActive, version)`(只保留单版本语义,version 字段保留兼容旧数据但不递增)
- `WorkflowStage`: 2 段固定 `DO` / `DELIVER`,字段 `phase` `code` `name` `sort` `description`
- `WorkflowTask`: `code` `name` `sort` `description` `requiredRole`(可选,保留)
- `WorkflowTaskInstance`: `projectId` `taskId` `status`(5 态全保留) `assigneeId` `dueDate` `remark` `completedAt` `completedById` + 时间戳

**状态机**
- `Project.status`: `PLANNED / IN_PROGRESS / SUSPENDED / CLOSED / CANCELLED`(5 态,删 `DELIVERED` `ACCEPTED`)
- 转换:`PLANNED → IN_PROGRESS → CLOSED`(中间可 `SUSPENDED ↔ IN_PROGRESS`,任何非终态可 `→ CANCELLED`)
- `WorkflowTaskInstance.status`: `PENDING / IN_PROGRESS / COMPLETED / SKIPPED / BLOCKED`(5 态全保留;`BLOCKED` 是真用,见 P9 task-drawer 的"阻塞/解阻"按钮)
- 阶段门控:`DO` 阶段未 `DONE`(全 COMPLETED+SKIPPED)时,`DELIVER` 阶段任务标 LOCKED;admin 可强制解锁(走"跳过门控"开关,见 PR-1)

**UI**
- 项目列表 + 项目详情(去掉"服务范围"以外的扩展卡)
- 项目详情右侧"活动历史"卡 → 改为"任务历史"(只展示 WorkflowTaskInstance 的状态变更流,见 §6.2)
- 工作流区段(任务折叠 + 抽屉)
- 看板(2 列 = DO / DELIVER)
- 我的工作流(全局)
- 工作流概览(管理员)
- 模板管理:仅 新建 / 编辑 / 激活/停用;**删** clone / import / export / diff / migrate 全部 5 个 endpoint + UI

**API**
- `/api/projects` GET/POST
- `/api/projects/[id]` GET/PATCH/DELETE
- `/api/projects/[id]/[action]` POST(动作集 `start/suspend/resume/close/cancel`)
- `/api/projects/[id]/workflow` GET
- `/api/projects/[id]/workflow/init` POST
- `/api/projects/[id]/workflow/board` GET(看板)
- `/api/projects/[id]/workflow/export` GET(JSON 导出,保留,管理审计需要)
- `/api/projects/[id]/pdf` GET
- `/api/projects/export` GET(Excel)
- `/api/workflow/my-tasks` GET
- `/api/workflow/overview` GET(管理员)
- `/api/workflow/overdue` GET(管理员)→ 简化为"启动超 14 天未完成",不再用 `estimateDays` 算超期
- `/api/workflow-tasks/[id]/action` POST(动作 `start/complete/skip/block/unblock`,删 `submit/approve/reject` 的二审分支)
- `/api/workflow-tasks/[id]/assign` PATCH
- `/api/workflow-tasks/[id]/remark` PATCH
- `/api/workflow-tasks/[id]/history` GET(任务状态变更流,替换原 ProjectHistory)
- `/api/admin/workflow-templates` GET
- `/api/admin/workflow-templates/[id]` GET/PATCH
- `/api/admin/workflow-templates/[id]/stages` `.../stages/[stageId]` `.../tasks` `.../tasks/[taskId]` `.../tasks/[taskId]/duplicate` 保留(模板编辑需要)
- `/api/admin/workflow-templates/[id]/clone` → **删**
- `/api/admin/workflow-templates/[id]/export` → **删**
- `/api/admin/workflow-templates/import` → **删**
- `/api/admin/workflow-templates/diff` → **删**
- `/api/admin/workflow-templates/tasks/migrate` → **删**

### 2.2 离开 乙档 (Out / 删)

| 类别 | 项 | 去向 |
|---|---|---|
| 数据模型 | `Project.serviceScope` 字段? | **保留**(项目详情有展示卡,form 有输入) |
| 数据模型 | `WorkflowTask.requiresDeliverable` | 删 |
| 数据模型 | `WorkflowTask.requiresOnsite` | 删 |
| 数据模型 | `WorkflowTask.requiresTwoStepReview` | 删 |
| 数据模型 | `WorkflowTask.isRecurring` `recurrenceUnit` `recurrenceInterval` | 删 |
| 数据模型 | `WorkflowTask.estimateDays` | 删 |
| 数据模型 | `WorkflowTaskInstance.parentInstanceId` | 删 |
| 数据模型 | `WorkflowTaskInstance.reviewStatus` `reviewedById` `reviewedAt` | 删 |
| 数据模型 | `WorkflowTaskInstance.attachments` (Json) | 删(任务不再挂附件) |
| 数据模型 | `ProjectProgressLog` 表 | 删(整张表) |
| API | `/api/projects/[id]/workflow/recurring` | 410 Gone |
| API | `/api/projects/[id]/workflow/upgrade-check` | 410 Gone |
| API | `/api/projects/[id]/history` | 410 Gone(由 `/api/workflow-tasks/[id]/history` 替代) |
| API | `/api/workflow/follow-ups` + `/workflow/follow-ups` 页面 | 410 Gone + 删页面 |
| API | `/api/workflow-tasks/[id]/attachments` `.../[id]/attachments/[attId]` | 410 Gone |
| API | `/api/workflow-tasks/[id]/review` | 410 Gone |
| API | `/api/admin/workflow-templates/[id]/clone` | 410 Gone |
| API | `/api/admin/workflow-templates/[id]/export` | 410 Gone |
| API | `/api/admin/workflow-templates/import` | 410 Gone |
| API | `/api/admin/workflow-templates/diff` | 410 Gone |
| API | `/api/admin/workflow-templates/tasks/migrate` | 410 Gone |
| UI | `components/workflow/project-history.tsx` | 删 |
| UI | `components/workflow/upgrade-modal.tsx` | 删 |
| UI | `components/workflow/my-tasks-widget.tsx` 中的二审/循环/预估天数 Tag | 删 Tag |
| UI | `app/(app)/workflow/board/page.tsx` 中的二审/审阅态 Tag | 删 Tag |
| UI | `app/(app)/statistics/workflow/page.tsx` 的"超期"列 | 改为"启动 14 天未完成" |
| UI | `app/(app)/admin/workflow-templates/page.tsx` 的"克隆"按钮 | 删按钮 + 提示语 |
| UI | `app/(app)/admin/workflow-templates/[id]/page.tsx` 的"导入/导出/差异/迁移"按钮 | 删按钮 |
| UI | `app/(app)/admin/workflow-templates/diff/page.tsx` | 删整页 |
| UI | `app/(app)/projects/[id]/page.tsx` 的"升级到最新模板"按钮 + 升级弹窗 | 删 |
| 后端逻辑 | `lib/validators/workflow.ts` 中 `attachments` `reviewStatus` 字段 | 删 |
| 后端逻辑 | `lib/validators/project.ts` 中 `deliver/accept/progress` 动作 | 删动作枚举 |
| 种子数据 | `prisma/seed.ts` 的 5 阶段 × 9 服务模板 | 改写为 2 阶段(DO/DELIVER) × 9 服务 |

### 2.3 待用户拍板的开放项

| # | 决策点 | 默认建议 |
|---|---|---|
| O-1 | `Project.serviceScope` 是否保留 | **保留**(有展示卡、有表单,不是死字段) |
| O-2 | `WorkflowTask.requiredRole` 是否保留 | **保留**(轻量,看板和抽屉有展示,seed 大量使用) |
| O-3 | `WorkflowTaskInstance.status` 是否保留 `BLOCKED` | **保留**(task-drawer 有"阻塞/解阻"按钮) |
| O-4 | 阶段门控 LOCKED 状态,admin 强制解锁的入口位置 | 项目详情工作流区段顶部一个"解锁下一阶段"按钮(仅 IN_PROGRESS 状态可见) |
| O-5 | 看板是否需要"按任务状态"二级筛选 | **不保留**(已有 pending/in-progress/blocked/completed/skipped 计数 Tag) |
| O-6 | `/api/workflow/overdue` 重定义为"启动超 14 天未完成"还是直接删 | **重定义保留**(管理员看板仍要有预警信号) |
| O-7 | `version` 字段在 `WorkflowTemplate` 上是否保留 | **保留兼容**(旧数据有 version=2/3,新模板写 version=1,不再递增) |
| O-8 | 项目状态机里 `IN_PROGRESS → CLOSED` 转换是否需要"所有任务全部完成"前置 | **不需要**(admin 可在仍有 PENDING 任务时关单,加确认弹窗) |

## 3. 目标数据模型

### 3.1 Prisma 目标(最终态,PR-2 落地)

```prisma
enum ProjectStatus {
  PLANNED
  IN_PROGRESS
  SUSPENDED
  CLOSED
  CANCELLED
}

enum WorkflowPhase {
  DO
  DELIVER
}

enum WorkflowTaskInstanceStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  SKIPPED
  BLOCKED
}

model Project {
  id            String    @id @default(cuid())
  projectNo     String    @unique
  contractId    String
  contract      Contract  @relation(fields: [contractId], references: [id])
  name          String
  serviceScope  String
  managerUserId String
  startDate     DateTime  @db.Timestamptz(6)
  endDate       DateTime  @db.Timestamptz(6)
  status        ProjectStatus @default(PLANNED)
  createdAt     DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt     DateTime  @updatedAt @db.Timestamptz(6)
  createdById   String
  updatedById   String
  deletedAt     DateTime? @db.Timestamptz(6)

  taskInstances WorkflowTaskInstance[]

  @@unique([contractId, name])
  @@index([contractId])
  @@index([status])
  @@index([managerUserId])
}

model WorkflowTemplate {
  id          String    @id @default(cuid())
  serviceType String
  name        String
  version     Int       @default(1)   // 保留兼容
  isActive    Boolean   @default(true)
  description String?
  createdById String
  createdAt   DateTime  @default(now()) @db.Timestamptz(6)
  updatedAt   DateTime  @updatedAt @db.Timestamptz(6)
  deletedAt   DateTime? @db.Timestamptz(6)

  stages WorkflowStage[]

  @@unique([serviceType, isActive])
  @@index([serviceType])
  @@index([isActive])
}

model WorkflowStage {
  id          String           @id @default(cuid())
  templateId  String
  template    WorkflowTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  phase       WorkflowPhase
  code        String
  name        String
  sort        Int
  description String?
  isRequired  Boolean          @default(true)

  tasks WorkflowTask[]

  @@index([templateId, phase])
}

model WorkflowTask {
  id                    String        @id @default(cuid())
  stageId               String
  stage                 WorkflowStage @relation(fields: [stageId], references: [id], onDelete: Cascade)
  code                  String
  name                  String
  sort                  Int
  description           String?
  requiredRole          String?
  requiredRoleRef       Role?         @relation(fields: [requiredRole], references: [code], onDelete: Restrict, onUpdate: Cascade)

  instances WorkflowTaskInstance[]

  @@index([stageId, sort])
  @@index([requiredRole])
}

model WorkflowTaskInstance {
  id            String                       @id @default(cuid())
  projectId     String
  project       Project                      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  taskId        String
  task          WorkflowTask                 @relation(fields: [taskId], references: [id], onDelete: Cascade)
  status        WorkflowTaskInstanceStatus   @default(PENDING)
  assigneeId    String?
  dueDate       DateTime?                    @db.Timestamptz(6)
  remark        String?
  completedAt   DateTime?                    @db.Timestamptz(6)
  completedById String?
  createdAt     DateTime                     @default(now()) @db.Timestamptz(6)
  updatedAt     DateTime                     @updatedAt @db.Timestamptz(6)
  deletedAt     DateTime?                    @db.Timestamptz(6)

  @@unique([projectId, taskId])  // parentInstanceId 没了,这条 unique 还原成 2 字段
  @@index([projectId, status])
  @@index([assigneeId, status])
}

// ProjectProgressLog 整张表删除
```

### 3.2 数据迁移规则 (PR-2 内 SQL 一次完成)

| 来源 | 去向 | 规则 |
|---|---|---|
| `Project.status = DELIVERED` | `CLOSED` | 直接置 |
| `Project.status = ACCEPTED` | `CLOSED` | 直接置 |
| `WorkflowStage.phase = PREP/REQUIREMENT/CONTRACT` | `DO` | 任务一并迁;`sort` 重新连续编号 |
| `WorkflowStage.phase = EXECUTE` | `DO` | 同上 |
| `WorkflowStage.phase = FOLLOWUP` | `DELIVER` | 同上 |
| `WorkflowTask.requiresDeliverable = true` | (字段删除) | 不动数据 |
| `WorkflowTask.requiresOnsite = true` | (字段删除) | 不动数据 |
| `WorkflowTask.requiresTwoStepReview = true` | (字段删除) | 模板级 flag 删,不动实例数据;**实例 status 由下一行 `reviewStatus → status` 决定** |
| `WorkflowTask.isRecurring = true` | (字段删除) | 只保留**已生成的**历史实例(parentInstanceId 删字段),不自动生成新实例;新模板不再配置循环 |
| `WorkflowTask.estimateDays = N` | (字段删除) | 不动数据 |
| `WorkflowTaskInstance.reviewStatus IN (REVIEWING/REVIEWED/APPROVED/REJECTED)` | 映射为 status | `REVIEWING → IN_PROGRESS`,`REVIEWED/APPROVED → COMPLETED`,`REJECTED → BLOCKED` |
| `WorkflowTaskInstance.attachments` (Json) | (字段删除) | 不动数据;若需找回可从 `lib/server/storage/` 走 MinIO 路径追溯 |
| `ProjectProgressLog` 全表 | 删 | 在 30 天内可走备份恢复;无需额外操作 |

### 3.3 阶段 LOCKED 派生(纯计算,无新字段)

`phaseState` 在 `/api/projects/[id]/workflow` 和 `/api/projects/[id]/workflow/board` 两个端点现算:

```
DO.phaseState =
  total = 0          → READY (无任务)
  completed/total=1  → DONE
  否则                → PARTIAL

DELIVER.phaseState =
  DO != DONE         → LOCKED
  否则                → READY (同 DO 规则)
```

UI 展示 LOCKED 时,任务卡置灰 + LockOutlined 图标;"解锁下一阶段" 按钮(admin 可见)调用 `POST /api/projects/[id]/workflow/force-unlock` (新加,见 §4)。

> **force-unlock 持久化**:走 `OperationLog`,**不**新增 schema 列/表。计算 phaseState 时 OR 一条 `OperationLog.action = 'FORCE_UNLOCK_STAGE'` 的存在性检查(带 `(projectId, stageId)` 索引,见现有 `OperationLog` 索引 `@@index([entityType, entityId, createdAt])`)。OperationLog 模块不在本次 scope,但其 schema 已有空间(`action` 字段是 String),无需迁移。

## 4. API 表面

### 4.1 新增 1 个

```
POST /api/projects/[id]/workflow/force-unlock
  body: { stage: "DO" | "DELIVER" }
  权限: ADMIN
  行为: 写一条 OperationLog(action="FORCE_UNLOCK_STAGE", metadata={ projectId, stageId, stage })
        不改 WorkflowTaskInstance.status,不改 WorkflowStage
  派生: phaseState 计算时,如果 (projectId, stageId) 命中上述 OperationLog,跳过 LOCKED 直接置 READY
  幂等: 同一 (projectId, stageId) 多次调用只写一条 OperationLog
  返回: { code: 0, data: { operationLogId, stage } }
```

### 4.2 410 Gone (PR-1 内一次性返回)

```
GET  /api/projects/[id]/workflow/recurring
POST /api/projects/[id]/workflow/upgrade-check
GET  /api/projects/[id]/history
GET  /api/workflow/follow-ups
GET  /api/workflow-tasks/[id]/attachments
DEL  /api/workflow-tasks/[id]/attachments/[attId]
POST /api/workflow-tasks/[id]/review
POST /api/admin/workflow-templates/[id]/clone
GET  /api/admin/workflow-templates/[id]/export
POST /api/admin/workflow-templates/import
GET  /api/admin/workflow-templates/diff
POST /api/admin/workflow-templates/tasks/migrate
```

实现方式:在每个 route.ts 顶部加:
```ts
export async function GET() { return Response.json({ code: 41001, message: "此端点已下线,见 docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md" }, { status: 410 }); }
```

### 4.3 字段裁剪 (PR-1)

`/api/projects` POST/PATCH:
- 入参 schema 删 `serviceScope`? **不删**(O-1 决定保留)
- 入参 schema 删 `budgetAmount`? **已删**(前面 PR 已做)

`/api/projects/[id]/[action]`:
- 动作枚举从 8 个压到 5 个:`start / suspend / resume / close / cancel`
- 删:`deliver / accept / progress`

`/api/workflow-tasks/[id]/action`:
- 动作枚举从 7 个压到 5 个:`start / complete / skip / block / unblock`
- 删:`submit / approve / reject`(原二审流程;在 PR-1 把 `requiresTwoStepReview` 任务统一转成普通 `complete` 流程,见 §6.1)

`/api/workflow/overdue`:
- 计算口径:`started_at IS NOT NULL AND started_at < now() - interval '14 days' AND status IN ('PENDING','IN_PROGRESS','BLOCKED')`
- 不再用 `estimateDays` 算 `elapsedDays - estimateDays`
- 响应字段:`{ total, items: [{ id, taskName, projectId, projectName, startedAt, daysElapsed }] }`

## 5. UI 表面

### 5.1 改动一览

| 页面 | 改动 | 复杂度 |
|---|---|---|
| `/projects` (list) | 不动 | 0 |
| `/projects/new` | 删 "服务范围" 输入? **不删**(O-1 保留) | 0 |
| `/projects/[id]` (detail) | 删"活动历史"卡右侧 → 改"任务历史"卡(走 `/api/workflow-tasks/[id]/history` 聚合);删"升级到最新模板"按钮;删"导出 JSON"按钮? **保留**(管理审计需要) | 中 |
| `/projects/[id]/edit` | 删 `serviceScope`? **不删** | 0 |
| `/workflow` (my-tasks) | 删"二审/循环/交付物" Tag | 小 |
| `/workflow/board` | 删"二审/审阅态" Tag;2 列(DO/DELIVER) | 小 |
| `/workflow/follow-ups` | **删整页** | 0 |
| `/admin/workflow-templates` (list) | 删"克隆"按钮 + "历史版本"展示 | 小 |
| `/admin/workflow-templates/[id]` (editor) | 删"导入/导出/差异/迁移"按钮;任务 Form 删 `estimateDays/requiresDeliverable/requiresOnsite/requiresTwoStepReview/isRecurring/recurrenceUnit/recurrenceInterval` 字段 | 中 |
| `/admin/workflow-templates/diff` | **删整页** | 0 |
| `/statistics/workflow` (overview) | 删"超期"列(用新口径"启动 14 天未完成") | 小 |

### 5.2 关键组件改动

`components/workflow/workflow-section.tsx`:
- 阶段进度条:保持(2 个 tag)
- 任务卡 TaskCard:删 `requiresDeliverable` `requiresOnsite` `requiresTwoStepReview` `isRecurring` `estimateDays` 5 个 Tag
- 顶部工具条:**新增** admin 可见的"解锁 DELIVER 阶段"按钮(在 DELIVER LOCKED 时显示)

`components/workflow/task-drawer.tsx`:
- 头部 Tag:删 `requiresDeliverable` `requiresOnsite` `requiresTwoStepReview` `isRecurring` `estimateDays` 5 个
- 操作按钮:删"提交校核/审核通过/驳回"3 个(原二审流程)
- 附件区:删整个 `Upload` + `AttachmentList`(任务无附件)
- 保留:开始/完成/跳过/阻塞/解阻/编辑备注

`components/workflow/my-tasks-widget.tsx`:
- 删"二审/循环/交付物/预估天数" Tag

`components/workflow/project-history.tsx` → **删**(原组件展示项目级活动日志,与"任务状态流"语义不同;项目级活动仍可从 `OperationLog` 走 `lib/operation-log/...` 单独查,本次不重做)。
- 新组件 `components/workflow/task-history.tsx`(在项目详情右栏,替换原 ProjectHistory 位置):
  - 拉 `/api/projects/[id]/task-history`(新加,见 §4.1):聚合该项目所有 `WorkflowTaskInstance.status` 变更流
  - 展示:时间倒序,每行 `[时间] [任务名] [状态变更 PENDING→IN_PROGRESS] [操作人]`
  - 边界:本组件**不**展示项目级 OperationLog(只展示任务流);后续要扩"项目活动流"另开一个组件

## 6. 迁移计划

### 6.1 PR-1: 代码层清理(无 schema 改动)

**目标**:删 UI、删路由、删字段引用,但 DB 列原样保留

**范围**:

1. **新加 dead field blocklist**(放 `lib/cleanup-blocklist.ts`,集中一处):
   ```ts
   export const DEPRECATED_FIELDS = [
     "requiresDeliverable", "requiresOnsite", "requiresTwoStepReview",
     "isRecurring", "recurrenceUnit", "recurrenceInterval", "estimateDays",
     "parentInstanceId", "reviewStatus", "reviewedById", "reviewedAt",
     "attachments", "ProjectProgressLog"
   ] as const;
   ```
   PR-1 内 `lib/cleanup-blocklist.ts` 单测断言:`grep -rE "DEPRECATED_FIELDS.join('|')" app components lib` 应只剩白名单(用于在 PR-1 验证"代码不再用")。

2. **UI 改动**(同 §5.1,5.2)
3. **API 410 Gone**:§4.2 列举的 12 个端点
4. **`/api/workflow-tasks/[id]/action`** 动作枚举收敛到 5 个,加白名单检查:传 `submit/approve/reject` 返回 400
5. **`/api/projects/[id]/[action]`** 动作枚举收敛到 5 个,加白名单检查
6. **`/api/workflow/overdue`** 改口径
7. **`/api/admin/workflow-templates/[id]/page.tsx` 编辑表单**:任务 form 删 7 个字段
8. **`/api/admin/workflow-templates/page.tsx` 列表**:删"克隆"按钮
9. **新加**:`/api/projects/[id]/workflow/force-unlock` + 顶部"解锁下一阶段"按钮
10. **新加**:`/api/projects/[id]/task-history` 路由(原 `/api/projects/[id]/history` 410 Gone;**不复用**旧端点路径,避免语义混淆)
11. **新加**:`components/workflow/task-history.tsx`(替换 `project-history.tsx` 在项目详情右栏的位置)
12. **`prisma/seed.ts`**:改写为 2 阶段 × 9 服务
13. **`lib/validators/workflow.ts`** + **`lib/validators/project.ts`**:删字段、动作

**回归保护**:
- Vitest:删除或更新所有引用 `requiresDeliverable` 等字段的 unit test
- Playwright:5 个 spec 改写或删;新加 1 个 spec:`09-minimal-pm-workflow.spec.ts`,覆盖核心流(创建项目 → 初始化工作流 → 完成任务 → 关闭项目)
- 数据:**完全不动**,DB 仍是旧 schema

**回滚**:`git revert PR-1` 一把回滚,数据零损失。

**预计工作量**:1 个完整工作日

### 6.2 PR-2: Schema 真删(列/表/枚举)

**目标**:把 PR-1 留下的死列死表真删

**Prisma 迁移**(`prisma/migrations/20260623_minimal_pm_workflow/migration.sql`):

```sql
BEGIN;

-- 1. Project.status 数据迁移
UPDATE "Project" SET status = 'CLOSED' WHERE status IN ('DELIVERED', 'ACCEPTED');

-- 2. 任务实例 reviewStatus 数据迁移
UPDATE "WorkflowTaskInstance"
SET status = CASE
  WHEN "reviewStatus" = 'REVIEWING' THEN 'IN_PROGRESS'
  WHEN "reviewStatus" IN ('REVIEWED', 'APPROVED') THEN 'COMPLETED'
  WHEN "reviewStatus" = 'REJECTED' THEN 'BLOCKED'
  ELSE status
END
WHERE "reviewStatus" IS NOT NULL;

-- 3. 阶段 phase 数据迁移:先创建新 stage 行,再迁移 task 关联,再删旧行
DO $$
DECLARE
  template_record RECORD;
  do_stage_id TEXT;
  deliver_stage_id TEXT;
  old_stage RECORD;
  new_sort INT;
BEGIN
  FOR template_record IN SELECT id FROM "WorkflowTemplate" LOOP
    -- DO 阶段
    INSERT INTO "WorkflowStage" (id, "templateId", phase, code, name, sort, "isRequired", description)
    VALUES (gen_random_uuid()::text, template_record.id, 'DO', 'DO', '实施', 0, true, '实施阶段')
    RETURNING id INTO do_stage_id;

    -- DELIVER 阶段
    INSERT INTO "WorkflowStage" (id, "templateId", phase, code, name, sort, "isRequired", description)
    VALUES (gen_random_uuid()::text, template_record.id, 'DELIVER', 'DELIVER', '交付', 1, true, '交付阶段')
    RETURNING id INTO deliver_stage_id;

    -- 迁移 task: PREP/REQUIREMENT/CONTRACT/EXECUTE → DO, FOLLOWUP → DELIVER
    FOR old_stage IN SELECT * FROM "WorkflowStage" WHERE "templateId" = template_record.id ORDER BY sort LOOP
      new_sort := 0;
      IF old_stage.phase IN ('PREP', 'REQUIREMENT', 'CONTRACT', 'EXECUTE') THEN
        UPDATE "WorkflowTask" SET "stageId" = do_stage_id WHERE "stageId" = old_stage.id;
      ELSIF old_stage.phase = 'FOLLOWUP' THEN
        UPDATE "WorkflowTask" SET "stageId" = deliver_stage_id WHERE "stageId" = old_stage.id;
      END IF;
    END LOOP;

    -- 删旧 stage(级联删 task)
    DELETE FROM "WorkflowStage" WHERE "templateId" = template_record.id AND phase IN ('PREP', 'REQUIREMENT', 'CONTRACT', 'EXECUTE', 'FOLLOWUP');
  END LOOP;
END $$;

-- 4. 删除 ProjectProgressLog 整表
DROP TABLE IF EXISTS "ProjectProgressLog";

-- 5. 删除列
ALTER TABLE "WorkflowTask" DROP COLUMN "requiresDeliverable";
ALTER TABLE "WorkflowTask" DROP COLUMN "requiresOnsite";
ALTER TABLE "WorkflowTask" DROP COLUMN "requiresTwoStepReview";
ALTER TABLE "WorkflowTask" DROP COLUMN "isRecurring";
ALTER TABLE "WorkflowTask" DROP COLUMN "recurrenceUnit";
ALTER TABLE "WorkflowTask" DROP COLUMN "recurrenceInterval";
ALTER TABLE "WorkflowTask" DROP COLUMN "estimateDays";

ALTER TABLE "WorkflowTaskInstance" DROP COLUMN "parentInstanceId";
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN "reviewStatus";
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN "reviewedById";
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN "reviewedAt";
ALTER TABLE "WorkflowTaskInstance" DROP COLUMN "attachments";

-- 6. 修 unique 索引(原 3 字段 unique,删 parentInstanceId 后变 2 字段)
ALTER TABLE "WorkflowTaskInstance" DROP CONSTRAINT IF EXISTS "WorkflowTaskInstance_projectId_taskId_parentInstanceId_key";
CREATE UNIQUE INDEX "WorkflowTaskInstance_projectId_taskId_key" ON "WorkflowTaskInstance"("projectId", "taskId");

COMMIT;
```

**配套代码改动**:
1. `prisma/schema.prisma` 同步到 §3.1 目标模型
2. `prisma generate` 重生 client
3. `lib/cleanup-blocklist.ts` 删(任务完成)
4. 全仓 grep `DEPRECATED_FIELDS` 应为 0 结果
5. 删 PR-1 留下的 12 个 410 路由文件(代码真删,不留骸骨)
6. 重跑全套 Vitest + Playwright

**回滚**:`git revert PR-2` + `prisma migrate resolve --rolled-back 20260623_minimal_pm_workflow`。

**预计工作量**:半天(主要在 SQL 联调和回归测试)

### 6.3 部署顺序

```
PR-1 merge → CI green → 部署 dev → dev 用户冒烟 1 天 → 部署 staging → staging 1 天 → 部署 prod
PR-2 merge → CI green → 部署 dev → dev 用户冒烟 1 天 → 部署 staging → staging 1 天 → 部署 prod
```

中间留 buffer 是为了万一 PR-1 出现非预期死代码路径,可以在 PR-2 之前补 PR-1.1 hotfix。

## 7. 测试计划

### 7.1 Vitest 单元/集成

- 删:`tests/workflow-recurring.test.ts`(整文件)
- 删:`tests/workflow-two-step-review.test.ts`(整文件)
- 删:`tests/workflow-upgrade.test.ts`(整文件)
- 删:`tests/project-progress-log.test.ts`(整文件)
- 改:`tests/project-state-machine.test.ts` → 5 状态机(从 7 状态)
- 改:`tests/workflow-state-machine.test.ts` → 5 任务态(无变化)+ 二审分支全删
- 新加:`tests/minimal-pm-workflow.test.ts`:覆盖 §2.1 留下来的所有 API + 410 Gone 端点

### 7.2 Playwright E2E

- 改:`01-admin-full-flow.spec.ts`:模板编辑不测二审/循环/交付物/现场;模板不测克隆
- 改:`02-sales-flow.spec.ts`:项目创建 + 初始化工作流 + 完成任务 + 关闭项目
- 删:任何引用 `recurring` `upgrade` `follow-ups` `two-step-review` 的步骤
- 新加:`09-minimal-pm-workflow.spec.ts`:核心流(创建项目 → 初始化工作流 → 看板 → 任务完成 → 关闭项目),3 个 viewport 都过

### 7.3 手工冒烟

dev 用户列表里的 5 个账号(admin / sales / finance / ops / expert),每个跑一遍:
1. 创建项目(看项目列表不报错)
2. 初始化工作流(看阶段只有 2 个)
3. 看板(看 2 列)
4. 我的工作流(看任务 Tag 简化)
5. 工作流概览(看超期列新口径)
6. 模板编辑(看任务 form 干净)
7. 关闭项目(走 close 而非 deliver/accept)

## 8. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 生产已有 `DELIVERED`/`ACCEPTED` 项目 | 用户看不到状态,体验回退 | PR-2 SQL 一次性迁到 CLOSED,UI 文案 5 态已对齐 |
| 二审任务已走到 `REVIEWING` 中 | 任务卡在中间态 | PR-2 SQL 把 `REVIEWING` → `IN_PROGRESS`,用户重新点完成即可 |
| 循环任务有"下次未生成"语义 | 客户月报不再自动生成 | 在 release notes 显式提示;v0.3.0 后续若真要回归,新加 `isRecurring` 字段即可 |
| 模板管理的 clone/import/export 被外部脚本引用 | 集成方脚本失效 | 410 Gone 在 PR-1 阶段就生效,给集成方 1 周缓冲;无外部脚本(自查) |
| 服务范围 `serviceScope` 也想砍? | 用户额外反馈 | O-1 已决定保留;若用户改主意,可在 PR-2 后的 hotfix 删除 |
| 5 dev 账号在 PR-1 期间继续造数据 | PR-2 迁移多处理一些行 | 10K 行内 SQL 秒级;无性能问题 |

## 9. 文档更新

- `README.md` 加"工作流 v0.3.0 简化"小节,标注:已删除特性、二审/循环/交付物/现场/预估天数/项目日志 全部不再支持
- `docs/USER_MANUAL.md` 同步删相关章节
- `docs/DESIGN-v3.md` 在 §3(数据模型)补充新表结构(留到 PR-2 merge 后做,不在本 spec 范围)
- 本 spec 在 PR-2 merge 后归档到 `docs/superpowers/specs/_archive/2026-06-22-minimal-pm-workflow-design.md` 并在 commit 加 `Docs-Archive: true` 标记

## 10. 待用户拍板的开放项(汇总)

请在 review 时回这 8 个开放项(O-1 ~ O-8),默认值见 §2.3 表格右列。
