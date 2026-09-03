# 消息中心 v2 设计文档

> 最近同步：2026-09-03（v0.22.0 重新设计）
> 目标版本：v0.22.0
> 状态：实现中

本文档取代 v0.5.x 以来消息中心的散点设计，统一描述重做后的数据模型、API、UI、实时通道与 i18n。已有的 v0.5.x ~ v0.21.14 演进路径保留在 `CHANGELOG.md` 与 `docs/architecture/DESIGN-v3.md` 中。

## 0. 设计动机

当前消息中心在功能上「够用」，但暴露以下痛点：

1. **筛选弱**：仅 `unread=true|false`，无类型 / 关键词 / 日期筛选。
2. **批量操作缺失**：无法按类型/筛选条件批量已读或删除。
3. **抽屉 UX 粗糙**：手动分页、无 skeleton、消息数据靠「kick → 重拉」二次浪费。
4. **运营不可见**：管理员无法按类型 / 接收人统计未读分布。
5. **事件总线与渲染耦合**：20+ 业务类型 inline 在 `bus.ts` 的 `switch` 里，新类型改动 4 处。
6. **用户无偏好控制**：所有用户都接收 owner/admin 默认路由，无 opt-out。
7. **归档页简陋**：仅 month + receiverUserId，无类型/搜索。

## 1. 数据模型

### 1.1 既有模型保留

- `Message`、`MessageArchive` 不动；继续走 `entityKey` + `@@unique([entityKey, receiverUserId])` 行级去重。
- 归档任务 `runMessageArchive`（90 天阈值）保留；新增 `MESSAGE_ARCHIVE_AFTER_DAYS` 已生效。

### 1.2 新增 `MessagePreference`

```prisma
model MessagePreference {
  userId    String
  type      MessageType
  enabled   Boolean      @default(true)
  createdAt DateTime     @default(now()) @db.Timestamptz(6)
  updatedAt DateTime     @updatedAt @db.Timestamptz(6)

  user      User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, type])
  @@index([userId])
}
```

- **不存在即视为 `enabled=true`**：`bus.emit` 通过 `getDisabledTypes(userIds)` 过滤 receivers，避免给每个用户写 23 行默认记录。
- **Cascade 删除**：用户删除时偏好同步清理（与 User 级联一致）。
- **GRANT**：末尾追加 `GRANT ALL ON TABLE "MessagePreference" TO qt_app;`（沿用既有约定）。

## 2. 事件类型分组（前端消费）

`MessageType` 业务属性差异大，按域分组便于 UI 渲染和运营统计：

| 类别 (category) | 包含的 MessageType | 业务模块 |
|---|---|---|
| `contract` | CONTRACT_*、RISK_LEVEL_UP、CONTRACT_RENEWAL_REMIND、LINKAGE_* | 合同 |
| `finance` | INVOICE_*、PAYMENT_RECEIVED | 财务（开票/回款） |
| `reconciliation` | RECONCILIATION_* | 对账中心 |
| `certificate` | CERTIFICATE_EXPIRING | 员工证书 |
| `system` | 保留（未来系统类消息） | 系统 |
| `unknown` | CUSTOMER_STATUS_*（已下线） | 历史归档 |

分组定义在 `lib/message-categories.ts`，前后端共用同一份映射。

## 3. API 设计

### 3.1 既有路由（保持兼容 + 增强）

| Method | Path | 改动 |
|---|---|---|
| `GET` | `/api/messages` | 改为 cursor-based；新增 `types`、`categories`、`q`、`from`、`to`；返回 `nextCursor` |
| `GET` | `/api/messages/unread-count` | **保持**（dashboard shell 仍用） |
| `GET` | `/api/messages/unread-summary` | **新增**：按 category 分组返回 `{ category: count }[]` |
| `PATCH` | `/api/messages/[id]` | 保持 |
| `DELETE` | `/api/messages/[id]` | 保持 |
| `POST` | `/api/messages/mark-all-read` | body 增加 `{ types?, categories?, q?, from?, to? }` 限定范围 |
| `POST` | `/api/messages/read/clear` | 同上，限定范围 |
| `POST` | `/api/messages/batch` | **新增**：body `{ ids: string[], action: 'markRead' \| 'delete' }` |
| `GET` | `/api/messages/preferences` | **新增** |
| `PUT` | `/api/messages/preferences` | **新增** body `{ preferences: { type, enabled }[] }` |
| `GET` | `/api/messages/stream` | 升级：`kick` 之外支持 `message:new` 事件携带完整 row |
| `GET` | `/api/admin/messages-archive` | 增强 `types` / `q` / `receiverUserId` 三种过滤 |

### 3.2 Cursor 协议

```
GET /api/messages?cursor=eyJ...&limit=20
```

- 第一页：`cursor` 省略
- 服务端按 `createdAt desc + id desc` 排序，cursor = base64(`{createdAt, id}`)，前端只关心「下一页有没有」，不解析 cursor 内容。

### 3.3 实时通道协议

`text/event-stream`，事件名：

- `ready` — 连接建立（已有）
- `kick` — 让前端重拉（已有，保留兜底）
- `message:new` — 新消息到达，data = `{ id, type, title, content, link, createdAt, receiverUserId }`
- `:keepalive` — 25s 心跳

`message:new` 与 `kick` 行为差异：
- 旧：kick → 前端 mutate SWR 重拉 unread-count；列表页要重拉整个表格。
- 新：message:new → 前端直接 prepend 到列表顶部、unread badge +1，**不再走 fetch**。`kick` 仍作为兜底保留（多 tab / 网络抖动）。

## 4. 服务层拆分

```
server/services/message.ts                # 列表/已读/删除/清空 (重构)
server/services/message-preference.ts     # 订阅偏好 (新增)
server/services/message-archive.ts        # 归档查询 (从 message.ts 抽出)
server/services/message-batch.ts          # 批量操作 (新增)
server/events/bus.ts                      # 事件总线 (不变,emit 时过滤退订)
server/events/builder-registry.ts         # 类型 → 渲染函数 映射 (新增,把 20+ case 拆出去)
server/notifications/hub.ts               # SSE hub (支持 message:new)
```

## 5. UI 设计

### 5.1 `/messages` 页面

```
┌────────────┬─────────────────────────────────────────────┐
│ Sidebar    │ Toolbar: 搜索 | 类型多选 | 状态 | 日期 | 操作│
│ (分类)     ├─────────────────────────────────────────────┤
│            │                                              │
│ 全部  12  │ ProTable (row select + click navigate +     │
│ 合同  5   │  mark-read inline)                          │
│ 财务  3   │                                              │
│ 对账  2   │                                              │
│ 证书  1   │                                              │
│ 系统  0   │                                              │
│ ──────    │                                              │
│ 归档设置  │                                              │
│ 全部已读  │                                              │
└────────────┴─────────────────────────────────────────────┘
```

- 左侧分类 sidebar 来自 `unread-summary`，点击切换 `category` 过滤。
- 顶部 toolbar 包含搜索、类型多选、状态 tab、日期范围。
- 批量操作：勾选后顶部出现 batch action bar（已读 / 删除 / 取消）。
- 移动端：sidebar 折叠为顶部 chip 行；其余不变。

### 5.2 Dashboard 抽屉

- 列表按"今天 / 本周 / 更早"三段分组。
- 顶部 chip：全部 / 未读（带 badge）/ 已读。
- 收到 `message:new` 时直接 prepend 到「今天」分组。
- 列表项保持可点击跳转并自动 mark-read。
- 加载更多按钮保留。

### 5.3 偏好设置入口

- `/messages` 页面底部「订阅设置」按钮 → Drawer
- 列表展示所有 `MessageType`，每行一个 switch（默认开）
- 关闭后 `bus.emit` 不会再给该用户写对应类型的消息；历史消息保留

## 6. i18n 策略

- 文案 key 命名：`messages.<area>.<thing>`，例如 `messages.toolbar.search`、`messages.batch.markRead`。
- `bus.ts` 渲染的 title/content **仍存为渲染后字符串**（避免每次读 Message 都跑 i18n）：这是历史现状，重做不动这块。
- 所有 UI 控件（按钮、占位、确认弹窗）走 `useT()`。

## 7. 权限与审计

- `MESSAGE.READ` 既有权限矩阵保留（所有非只读角色都应有）。
- `MESSAGE.UPDATE` 包含：标记已读、批量已读、清空已读、改订阅偏好。
- `MESSAGE.DELETE` 包含：单条删除、批量删除。
- 审计事件：
  - `MESSAGE_MARK_READ`（单条）
  - `MESSAGE_MARK_ALL_READ`（既有）
  - `MESSAGE_CLEAR_READ`（既有）
  - `MESSAGE_DELETE`（既有）
  - `MESSAGE_BATCH_READ`（新增）
  - `MESSAGE_BATCH_DELETE`（新增）
  - `MESSAGE_PREFERENCE_UPDATE`（新增，entityId=userId，after = 新偏好 map）

## 8. 迁移与部署

- 新增 `MessagePreference` 表迁移 `20260903_message_preference`，末尾追加 `GRANT ALL ON TABLE "MessagePreference" TO qt_app;`。
- 不改 `MessageType` enum（保持 0 迁移负担）。
- 部署顺序：常规 prisma migrate deploy + release:publish。

## 9. 兼容性

- `GET /api/messages` 老的 `unread=true|false` + 翻页参数继续可用；客户端只解析 `list/total`，新增字段 `nextCursor` 不影响。
- `POST /api/messages/mark-all-read` body 为空时与旧行为一致（全部已读），新字段为可选。
- `POST /api/messages/read/clear` 同样兼容。

## 10. 不在本期范围

- 消息模板 i18n 化（继续硬编码中文）
- Redis pub/sub 跨实例推送
- 已读漏斗埋点
- 通知中心移动端原生推送（iOS/Android）
- 邮件 / 企微通道（已下线，保持）
