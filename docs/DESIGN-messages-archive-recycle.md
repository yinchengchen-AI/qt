# 消息归档与回收站 v0.24.0 设计文档

> 最近同步: 2026-09-04 (v0.24.0 实施)
> 目标版本: v0.24.0
> 状态: 已实施

本文档是 [DESIGN-messages-v2.md](./DESIGN-messages-v2.md) 的补充, 描述 v0.24.0 引入的"消息归档与回收站统一重做"。

## 0. 设计动机

v0.22.0 重做后的消息中心仍有以下痛点:

1. **删除不可恢复**: 用户从消息中心"批量删除"是 `prisma.message.delete` (hard delete), 误删无法找回。
2. **没有用户可见的归档**: `MessageArchive` 表 (90 天自动归档) 仅 admin 可见, 用户无法回查自己的归档。
3. **管理员视图单一**: `/admin/messages` 只展示归档, 业务上需要"代用户恢复误删"或"强制清理"时没有对应入口。
4. **三种"删除"语义混淆**: 用户硬删 / 90 天自动归档 / 业务记录软删, 各走各的代码路径。

## 1. 概念统一

把"删除/归档"统一为两套:

| 概念 | 数据源 | 用户可见 | 触发方式 | 何时真删 |
|---|---|---|---|---|
| **归档** | `MessageArchive` | ✅ 用户 + Admin | 90 天 cron (read+90d) | 永不 (append-only 审计) |
| **回收站** | `Message.deletedAt != null` | ✅ 用户 + Admin | 用户主动"移到回收站" (软删) | 30 天 cron (purge) |

`MessageArchive` 保留 append-only 语义 (审计回查); 不复用做回收站。

## 2. 数据模型

### 2.1 迁移 `20260904_message_recycle`

```sql
ALTER TABLE "Message"
  ADD COLUMN "deletedAt" TIMESTAMP(6) WITH TIME ZONE NULL;

-- 部分索引: 只索引已软删的行
CREATE INDEX "Message_deletedAt_idx"
  ON "Message"("deletedAt")
  WHERE "deletedAt" IS NOT NULL;

-- 用户维度查自己回收站
CREATE INDEX "Message_receiverUserId_deletedAt_idx"
  ON "Message"("receiverUserId", "deletedAt");
```

`qt_app` 已有表级 GRANT, 新列自动覆盖, 无需重复 GRANT。

## 3. Service 层变更 (`server/services/message.ts`)

### 3.1 `buildMessageWhere` 新增 `includeDeleted`

```ts
buildMessageWhere(userId, {
  // ... existing params
  includeDeleted?: boolean  // v0.24.0 新增
})
```

- `undefined` / `false`: inbox 口径, `where.deletedAt = null`
- `true`: 回收站口径, `where.deletedAt = { not: null }`

所有现有函数 (`listMessages` / `markAllRead` / `clearReadMessages` / `batchMutate` / `markRead`) 走这条 where 构造器, 默认排除已软删, 自动对齐新行为。

### 3.2 软删 / 恢复 / 硬删

```ts
// 之前: hard delete
export async function deleteMessage(user, id) { ... prisma.message.delete(...) }

// 之后: 软删 (alias 兼容老 API)
export async function softDeleteMessage(user, id): { ...set deletedAt = now }
// export const deleteMessage = softDeleteMessage;  // 兼容

// 新增: 恢复
export async function restoreMessage(user, id): { ...set deletedAt = null }
// readAt 保持原值

// 新增: 硬删 (owner, 跳过 30 天)
export async function purgeMessage(user, id): prisma.message.delete(...)
```

### 3.3 批量操作扩展

`batchMutate` 的 `action` 枚举从 `markRead | delete` 扩展为 `markRead | delete | restore | purge`:

- `delete` → 软删 (行为改变, 从 hard 变 soft)
- `restore` → 批量从回收站恢复
- `purge` → 批量硬删 (仅已软删的能被 purge)

### 3.4 Admin 新增函数

```ts
listArchivedMessages(user, { mode?: "archive" | "recycle", ... })
// mode=recycle 查 Message.deletedAt != null (新增)
restoreArchivedToInbox(user, archiveId)   // 归档 → inbox (创建新 row)
adminRestoreRecycled(user, ids)            // 回收站批量恢复
adminPurgeRecycled(user, ids)              // 回收站批量硬删
listUsersForFilter(user)                   // 接收人下拉数据
```

### 3.5 用户侧新函数

```ts
listUserArchive(user, params)   // 列出自己归档 (MessageArchive where receiverUserId = self)
listRecycleBin(user, params)    // 列出自己已软删 (Message where deletedAt != null AND receiverUserId = self)
restoreUserArchive(user, archiveId)  // 自己的归档 → inbox (创建新 row, readAt = null)
```

## 4. Jobs

### 4.1 修改: `runMessageArchive`

candidates query 增加 `deletedAt: null` 过滤, 跳过已软删的行。防止:
- 归档后被回收站 cron 重复清理
- "用户主动删掉的"消息被归档泄露

### 4.2 新增: `runMessageRecyclePurge`

```ts
// server/jobs/message-recycle-purge.ts
export async function runMessageRecyclePurge(
  now: Date = new Date(),
  txOrClient = prisma
): Promise<MessageRecyclePurgeResult> {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - DEFAULT_AFTER_DAYS);  // 默认 30 天
  // 找 deletedAt < cutoff 的行
  // $transaction 包, batch 1000
}
```

env `MESSAGE_RECYCLE_PURGE_DAYS` 控制阈值 (默认 30)。

### 4.3 runner 接入

`server/jobs/runner.ts` 03:00 hourly tick 内, 挂在 `runMessageArchive` 之后 (同一 tick, 顺序最末)。

## 5. API 路由

### 5.1 用户侧

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/messages` | 新增 `?includeDeleted=true` 切换回收站视图 |
| DELETE | `/api/messages/[id]` | 改为软删 (行为变更) |
| POST | `/api/messages/[id]/restore` | 新增, owner 恢复 |
| POST | `/api/messages/[id]/purge` | 新增, owner 硬删 |
| POST | `/api/messages/batch` | action 扩展为 `markRead \| delete \| restore \| purge` |
| GET | `/api/messages/recycle` | 新增, 列自己回收站 |
| GET | `/api/messages/archive` | 新增, 列自己归档 |
| POST | `/api/messages/archive/[id]/restore` | 新增, 用户恢复自己归档到收件箱 |
| POST | `/api/messages/mark-all-read` | 自动排除已软删 (服务层已处理) |
| POST | `/api/messages/read/clear` | 改为软删 (服务层已处理) |

### 5.2 管理侧 (`/api/admin/messages-archive/`)

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/admin/messages-archive?mode=archive\|recycle` | mode 切换 (默认 archive) |
| POST | `/api/admin/messages-archive/[id]/restore` | 新增, body `{ mode }` |
| POST | `/api/admin/messages-archive/batch` | 新增, body `{ ids, mode, action }` |
| GET | `/api/admin/messages-archive/users` | 新增, 接收人下拉数据 |

`/admin/trash` 保持原状 (继续管业务记录: Customer/Contract/Invoice/Payment)。

## 6. UI 设计

### 6.1 用户 `/messages` 页面

5 个 tab 顺序: **全部 / 未读 / 已读 / 归档 / 回收站**

- 前 3 个 tab: 行为基本不变, "批量删除" 改为"移到回收站" (文案 + 二次确认)
- **归档 tab**: ProTable reading `/api/messages/archive`
  - 列: type / title / content / createdAt / archivedAt
  - 行操作: 查看 (link) / 移到收件箱 (走 `restoreUserArchive`)
  - 批量 bar: 移到收件箱
- **回收站 tab**: ProTable reading `/api/messages/recycle`
  - 列: type / title / content / createdAt / deletedAt + 已读/未读状态
  - 行操作: 查看 (link) / 恢复 / 彻底删除
  - 批量 bar: 恢复 / 彻底删除

支持 `?tab=archive` / `?tab=recycle` deep link (Dashboard 抽屉底部加 "查看归档" / "查看回收站" 链接)。

### 6.2 管理 `/admin/messages` 页面

顶部 `Segmented` 切换: **归档 / 回收站**

- 归档模式 (默认): 行为接近现状, 新增行操作 "移到收件箱" + 月份过滤 + 接收人姓名搜索 (`/api/admin/messages-archive/users`)
- 回收站模式: 列 type / title / content / receiverName / deletedAt, 行操作 "恢复" / "彻底删除", 批量恢复 / 批量彻底删除

接收人展示从纯 userId 升级为 `name (employeeNo)`, 通过 `/users` 接口查 User 表。

## 7. i18n 新增键 (中英两套)

`messages.tab.archive` / `messages.tab.recycle`
`messages.archive.empty` / `messages.recycle.empty` / `messages.recycle.subtitle` / `messages.archive.subtitle`
`messages.action.moveToRecycle` / `moveToInbox` / `restore` / `purge`
`messages.recycle.restoreConfirm.{title,content}` / `messages.recycle.purgeConfirm.{title,content}` / `messages.recycle.moveConfirm.{title,content}`
`messages.toast.movedToRecycle{n}` / `movedToInbox{n}` / `restored{n}` / `purged{n}`
`messages.batch.moveToRecycle` / `restore` / `purge` / `restoreConfirmTitle` / `restoreConfirmContent` / `purgeConfirmTitle` / `purgeConfirmContent`
`messages.drawer.viewArchive` / `viewRecycle`
`admin.messagesArchive.mode.archive` / `mode.recycle`
`admin.messagesArchive.action.moveToInbox` / `restore` / `purge`
`admin.messagesArchive.batch.restore` / `purge`
`admin.messagesArchive.column.receiverName` / `column.deletedAt`
`admin.messagesArchive.filter.deletedBefore` / `filter.deletedAfter`
`admin.messagesArchive.confirm.moveToInbox` / `confirm.purge`
`admin.messagesArchive.empty.recycle`

更新: `messages.batch.deleteConfirmContent` 从 "将永久删除所选消息,不可恢复" 改为 "将把所选消息移入回收站,30 天后自动清除"。

## 8. 审计

新增审计事件 (全部走 `audit()` 助手):

| Action | 触发 |
|---|---|
| `MESSAGE_RECYCLE` | 单条 / 批量软删 (user) |
| `MESSAGE_RESTORE` | owner 从回收站恢复单条 |
| `MESSAGE_PURGE` | owner 硬删单条 (跳过 30 天) |
| `MESSAGE_BATCH_RECYCLE` | 批量软删 |
| `MESSAGE_BATCH_RESTORE` | 批量恢复 (user) |
| `MESSAGE_BATCH_PURGE` | 批量硬删 (user) |
| `MESSAGE_BATCH_RESTORE_ADMIN` | admin 批量恢复 |
| `MESSAGE_BATCH_PURGE_ADMIN` | admin 批量硬删 |
| `MESSAGE_ARCHIVE_RESTORE` | admin 从归档恢复到收件箱 (新 row) |
| `MESSAGE_ARCHIVE_RESTORE_USER` | user 从自己归档恢复到收件箱 (新 row) |
| `MESSAGE_RECYCLE_PURGE` | cron 清理 (actor=system) |

`MESSAGE_DELETE` (单条) 已被 `MESSAGE_RECYCLE` 替代; 老 API path 仍兼容。

## 9. 测试

新增/修改 6 个测试文件, 共 34 例新测试:

- `tests/unit/server/message.test.ts` (改 5 例, 软删/clearReadMessages 行为变更)
- `tests/api/messages-v2-routes.test.ts` (增 3 例, `?includeDeleted` 三态契约)
- `tests/api/messages-recycle.test.ts` (新增 16 例, 软删/恢复/硬删/批量/越权/列表)
- `tests/api/messages-archive-user.test.ts` (新增 4 例, 用户归档/恢复)
- `tests/api/admin-messages-archive.test.ts` (新增 11 例, mode 切换/admin 恢复/admin 硬删/非 admin 403)
- `tests/jobs/message-recycle-purge.test.ts` (新增 4 例, 30 天阈值/边界/batch/事务)

## 10. 部署与回滚

- 走标准 `npm version minor` → `scripts/prod/deploy.sh`
- 新迁移幂等 (`ALTER TABLE ... ADD COLUMN` IF NOT EXISTS 在 Prisma 7 自动处理)
- 回滚: 用 `scripts/prod/rollback.sh` 回代码 (DB 列保留不影响功能; 所有读路径都通过 `buildMessageWhere` 过滤)

## 11. 兼容性与迁移

- **API 形状**: `GET /api/messages` 老客户端 `?unread=true|false` + 翻页参数继续可用; 新增 `?includeDeleted` 不影响
- **行为变更**: 之前硬删的消息 (v0.22.0 及之前) 已不可恢复; 升级后只对新消息生效
- **i18n**: 已有客户端的 `messages.batch.deleteConfirmContent` 文案变更 ("永久删除" → "移到回收站")
- **DB drift**: `Message.deletedAt` 是新列, 漂移恢复时同步检查 (见 `docs/ops/db-bootstrap.md` 备注)

## 12. 不在本期范围

- 消息模板 i18n 化 (继续硬编码中文)
- Redis pub/sub 跨实例推送
- 已读漏斗埋点
- 通知中心移动端原生推送
- 邮件 / 企微通道 (已下线)
- 归档/回收站的导出 (Excel)
- 回收站项与业务记录 (合同/发票) 的关联展示
