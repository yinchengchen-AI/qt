# 代码审查报告 — 公告 / 消息 功能

> **注**：本审查于 2026-06-23 完成。v0.5.0(2026-06-29)起, 范围中的 `server/jobs/customer-status-suggest.ts` 随客户状态机整体下线而删除, 下文中相关条目仅作历史参考。`MessageType` enum 中 `CUSTOMER_STATUS_SUGGEST` / `CUSTOMER_STATUS_AUTO_APPLIED` / `CUSTOMER_STATUS_AUTO_REVERTED` 3 个值仍保留 (历史消息 fallback 渲染, 不再 emit)。
>
> 审查日期：2026-06-23
> 范围(2026-06-29 更新, 移除 customer-status-suggest job):`app/(app)/announcements`、`app/(app)/messages`、`app/api/announcements/**`、`app/api/messages/**`、`server/services/{announcement,message}.ts`、`server/events/**`、`server/jobs/{runner,contract-automation}.ts`(v0.5.0 起 `customer-status-suggest` 已删)、`server/audit.ts`、`lib/message-link.ts`、`lib/notify-config.ts`、`components/dashboard-shell.tsx`（消息抽屉/Bell Badge 部分）、`prisma/schema.prisma`（Message/Announcement/OperationLog 三张表）。
> 总体评分：**合格偏上**（拆分与事件总线设计清晰、inbox 事务内 + 外部通道 fire-and-forget 解耦、目标角色过滤与生效期过滤都在 SQL 层完成、有部分 job 单元测试(customer-status-suggest 等, 后者 v0.5.0 随客户状态机下线而删)）。但 **存在 1 个真实安全漏洞 + 1 个性能债务 + 若干一致性 / 死代码 / 测试缺位问题**，建议在 P4 修复。

## 维度评分

| 维度 | 评分 | 关键问题 |
|---|---|---|
| 架构分层 | 优秀 | route → service → Prisma 事务，事件总线与外部通道职责分离（inbox 事务内、外部通道 fire-and-forget） |
| 鉴权 / 授权 | **需改进** | `getAnnouncement` 没有按 `targetRoles` 过滤，越权可读非自己角色的公告（P0） |
| 性能 | **需改进** | `emit` 顺序 `for-await prisma.message.create` 是 N+1 写；dashboard-shell 每 60s 拉一次未读 count，无缓存 |
| 代码重复 / 一致性 | **需改进** | `dispatcher.ts` 里的 `TYPE_TO_TEMPLATE` 是死代码且与 `bus.ts` 模板不一致；`channels.ts:kindToPath` 与 `lib/message-link.ts:MESSAGE_LINK_PATH` 是两份独立的 URL map |
| 可测试性 | 需改进 | `message.ts` / `announcement.ts` / `bus.emit` 都没有单测；只有 `customer-status-suggest` job 有覆盖 (v0.5.0 随客户状态机下线而删, 现有 job 单测见 `tests/unit/server/contract-automation.test.ts`) |
| 可观测性 | 良好 | `announcement` CRUD 走 `audit()`，自动捕获 IP/UA/requestId；`Message` 操作（标记已读/删除）按设计本就不记审计，但删除消息建议加一行轻量审计 |
| 安全 / XSS | 良好 | 公告/消息内容走 React 自动转义（`<Paragraph>{detail.content}</Paragraph>`），未使用 `dangerouslySetInnerHTML` |
| 数据完整性 | 良好 | 公告 `deletedAt` 软删 + 列表默认过滤；`markRead` 幂等；`markAllRead` 用 `updateMany`；`emit` 在事务内调用保证 inbox 原子性 |
| 类型安全 | 合格 | `bus.ts:49-50` 用了 `as unknown as` 把 `ResolvedMessage` 强转回去；`Message.link` 是 `Json?` 缺 Zod 约束，未来可能 schema 漂移 |

---

## P0 必修

### [P0-1] `getAnnouncement` 缺角色过滤，存在垂直越权
- **文件**：`server/services/announcement.ts:32-37`
- **问题**：
  ```ts
  export async function getAnnouncement(user: SessionUser, id: string) {
    requirePermission(user.roleCode, RESOURCE.ANNOUNCEMENT, ACTION.READ);
    const a = await prisma.announcement.findFirst({ where: { id, deletedAt: null } });
    if (!a) throw new ApiError(ERROR_CODES.NOT_FOUND, "公告不存在", 404);
    return a;
  }
  ```
  - `listAnnouncements` 的 where 里同时检查 `targetRoles` + `effectiveTo/From`（`announcement.ts:16-22`），保证 SALES/FINANCE/EXPERT 只看到自己角色的公告；但 `getAnnouncement` 直接按 id 拉。
  - 一个 SALES 用户拿到 `/api/announcements/<id>`（id 可以是枚举/从别人那泄漏），能看到本来只发给 ADMIN 或 OPS 的公告。
- **建议**：把 `listAnnouncements` 的过滤条件抽成一个 `visibilityWhere(user)` helper，`getAnnouncement` / `updateAnnouncement` / `softDeleteAnnouncement` 都复用：
  ```ts
  function visibilityWhere(user: SessionUser): Prisma.AnnouncementWhereInput {
    return {
      deletedAt: null,
      AND: [
        { OR: [{ targetRoles: { isEmpty: true } }, { targetRoles: { has: user.roleCode } }] },
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
        { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: new Date() } }] },
      ],
    };
  }
  // 改动后
  const a = await prisma.announcement.findFirst({ where: { AND: [{ id }, visibilityWhere(user)] } });
  ```
  另外 `updateAnnouncement` / `softDeleteAnnouncement` 已经在 service 内做权限校验，没有越权写入风险，但同样应当用 `findFirst({ where: { AND: [{ id, deletedAt: null }, visibilityWhere(user)] } })` 保证读到的就是有权改的那条 — 当前实现 findFirst 没用 visibilityWhere 是潜在的 *隐式假定*（OPS/ADMIN 全部有权），需要注释清楚"假定只 ADMIN/OPS 调用"或加防御性 check。

### [P0-2] `emit` 顺序 N+1 写
- **文件**：`server/events/bus.ts:45-47`
- **问题**：
  ```ts
  for (const d of data) {
    await prisma.message.create({ data: d });
  }
  ```
  注释说"避免 createMany 在某些 adapter 上不可用"，但项目只用 Prisma + PostgreSQL，createMany 完全可用且支持。
  - 每个 receiver 一次 round-trip。Cron 一次跑几十到上百条（合同到期 30/7/1 天 × 全部 ACTIVE 合同 × (owner + admin list)），会出现 100+ 次串行 insert。
  - 同时 **不包事务**：如果循环中途某条 insert 失败，前面的已经写入但失败的不写，重跑时也未必能完整补偿（`exists` 去重判断在 emit 之前一次性查，今日去重但日间次序影响最终一致）。
- **建议**：
  ```ts
  await prisma.message.createMany({ data });
  ```
  或：
  ```ts
  await prisma.$transaction(data.map((d) => prisma.message.create({ data: d })));
  ```
  推荐 `createMany`（一行 SQL `INSERT ... VALUES (...), (...)`），并保留外部通道的 `dispatchExternalChannels` fire-and-forget 语义。

### [P0-3] `dispatcher.ts:TYPE_TO_TEMPLATE` 是死代码 + 模板漂移风险
- **文件**：`server/events/dispatcher.ts:17-90`
- **问题**：
  - `dispatchExternalChannels` 接收 `messages: ResolvedMessage[]`，这个数组是从 `bus.emit` 传入的（line 50），里面已经是 `bus.buildMessage` 渲染好的 title/content/link。
  - `TYPE_TO_TEMPLATE` 这个 map 整段（line 17-90）**没有任何代码调用它**（grep 全仓库 0 命中，仅 `export { TYPE_TO_TEMPLATE, formatDate }` 重新导出被保留）。
  - 历史上有过 `bus.ts` 用 `TYPE_TO_TEMPLATE` 的版本，重构后忘了删。`dispatcher.ts:137 export { TYPE_TO_TEMPLATE, formatDate }` 是为了"保留向后兼容"，但下游没人用。
  - 而且这份模板里的字段拼装和 `bus.ts:buildMessage` 实际在用的版本**已经不一致**：dispatcher 的 `CONTRACT_PENDING_REVIEW` 模板写的是 `"签订日期 ...，请尽快审核。"`，和 bus.ts 一致；但 **dispatcher 没有 `CONTRACT_AUTO_EXECUTED` / `CONTRACT_AUTO_COMPLETED` / `CONTRACT_AUTO_EXPIRED` 三种 case**，将来谁误以为 dispatcher 是单一事实源去加新事件就会漏在 inbox。
- **建议**：删掉 `TYPE_TO_TEMPLATE` 与对应 export；保留 `formatDate`（dispatcher 内部没用，但导出无害）；在文件头加注释明确"inbox 渲染在 `bus.ts:buildMessage` 是唯一入口，dispatcher 仅负责把已渲染的消息分发到外部通道"。

---

## P1 重要

### [P1-1] `dashboard-shell` 60s 轮询未读数没有缓存 / 去重
- **文件**：`components/dashboard-shell.tsx:242-265`
- **问题**：
  - `loadUnread` 每 60s 一次无条件 fetch，团队里 50 个用户同时在线就是 50 次 `/api/messages?page=1&pageSize=1&unread=true` 每分钟。
  - 服务端 `listMessages` 在 `prisma.message.count({ where: { receiverUserId, readAt: null } })` 上没有 `@@index([receiverUserId, readAt])` —— 但 schema line 316 实际**有**这个索引，所以单条 count 很快；但 50 并发 count 在 PostgreSQL 上仍然会有锁等待/内存抖动。
  - `setUnread(0)` 在 "全部标记已读" 后乐观清零，但若 `markAllRead` 服务端实际只 updated 了 25 条（极端 case 比如并发新增消息），UI 的 unread=0 与真实未读数不一致，且不会自动 refresh。
- **建议**：
  - 后端加 `GET /api/messages/unread-count`，只返回数字（不加 list 数据），减小 payload。
  - 改成 Server-Sent Events 或 SWR 轮询（已经用了 `swr` 库可以无痛接入）。
  - "全部已读"后 `await loadUnread()` 重新拉真实值，不要乐观清零。
  - 中长期：把 `unreadCount` 缓存到 Redis，TTL 5s；markRead / markAllRead 时主动 invalidate。

### [P1-2] `channels.ts:kindToPath` 与 `lib/message-link.ts:MESSAGE_LINK_PATH` 是两份独立的 URL map
- **文件**：`server/events/channels.ts:69-78`、`lib/message-link.ts:8-15`
- **问题**：
  - 前端跳转：`lib/message-link.ts` 暴露 `buildMessageLinkHref` 给 `dashboard-shell.tsx:632` 与 `app/(app)/messages/page.tsx:23` 使用，返回相对路径 `/contracts/<id>`。
  - 邮件/企微跳转：`channels.ts:kindToPath` 用 `${base}/contracts/${id}`，`base` 来自 `getPublicBaseUrl()`。
  - 两份独立维护的 map，加新 `link.kind` 时容易漏改一边，邮件里点了跳到 404。
- **建议**：让 `lib/message-link.ts` 暴露一个 `buildAbsoluteLinkHref(link, baseUrl)`，`channels.ts` 调用它；删掉 `channels.ts:kindToPath`。同时把 `project` / `asset` 这两个 kind 补进 `MESSAGE_LINK_PATH`（dispatcher 里发了但前端 map 里没有，会出现 `kind: project` 的消息点击无跳转）。

### [P1-3] `Message.link` 与 `link.kind` 缺 Zod / TS enum 约束
- **文件**：`prisma/schema.prisma:312` (`link Json?`)、`server/events/bus.ts` 全文
- **问题**：
  - 消息 `link` 是 `Json?`，全仓库没有一个 `MessageLinkSchema` 集中定义所有合法 kind。`bus.ts:buildMessage` 的 13 个 case 里硬编码 `kind: "contract" | "invoice" | "payment" | "project" | "customer" | "asset"` 与 `link.suggest` 这种扩展字段。
  - 前端 `MESSAGE_LINK_PATH` 又是另一份枚举；`customer` 路径下还出现过 `link.suggest`（`bus.ts:125`）但前端 `buildMessageLinkHref` 完全没读这个字段（仅看 `link.id`），意味着 `CUSTOMER_STATUS_SUGGEST` 的 `?suggest=<status>` 查询参数丢了，**用户点通知会直接落到 `/customers/<id>` 而不是带 suggest 状态**（dashboard-shell.tsx:632 `router.push(href)` 不带 query）。
  - **2026-06-29 更新 (v0.5.0)**：该问题随 `customer-status-suggest` job 与 `Customer.status` 字段整体下线而消失；`CUSTOMER_STATUS_SUGGEST` 不再 emit, `link.suggest` 写入分支已删, 仅作历史参考。
- **建议**：
  - 在 `lib/validators/message.ts` 定义 `messageLinkSchema` 单一枚举 + 子类型；`bus.ts` 拼 link 时过 schema；`MESSAGE_LINK_PATH` 用同一份类型生成（`as const` + 派生）。
  - 修 `buildMessageLinkHref`：把 `link.suggest` 这类额外字段作为 query string 拼回去，前端 dashboard-shell 拿到 `?suggest=FROZEN` 时由 `/customers/[id]` 页面读取并预填状态变更。
  - 数据库层：在 `Message` 表加一个生成列 `link_kind text generated always as (link->>'kind') stored` + `@@index([link_kind, createdAt])`，将来按 kind 过滤不用 JSON path 查询（虽然当前 case 已经有 `link: { path: ["id"], equals: ... }` 索引有效）。

### [P1-4] `Message` / `Announcement` service 层单测缺位
- **文件**：`server/services/message.ts`、`server/services/announcement.ts`、`server/events/bus.ts`
- **问题**：
  - `tests/unit/server/customer-status-suggest.test.ts`(v0.5.0 随客户状态机下线而删)曾验证了 job 的规则逻辑与去重，但 `bus.emit` 本身、`message.listMessages` / `markRead` / `markAllRead` / `deleteMessage`、`announcement.createAnnouncement` / `updateAnnouncement` / `softDeleteAnnouncement` 全部没有单测。
  - 特别是：
    - `markRead` 的幂等行为（已经读过再 PATCH 不应当重写 `readAt`）。
    - `markAllRead` 只更新 `readAt: null` 的部分，不影响已读。
    - `listMessages` 的 `unread` 过滤与 `unreadCount` 同时返回的语义。
    - `announcement` 的 `targetRoles` 包含用户角色 OR 列表为空（=全员）。
  - P0-1 提到的越权 fix 需要回归测试，否则下次重构可能再漏。
- **建议**：
  - 仿照 `tests/unit/server/customer-status-suggest.test.ts`(v0.5.0 随客户状态机下线而删, 替换为 `bus.emit` 直接构造)的 `vi.mock` 风格补：
    - `tests/unit/server/message.test.ts`（list / markRead / markAllRead / delete）
    - `tests/unit/server/announcement.test.ts`（list 角色过滤 / create / softDelete）
    - `tests/unit/server/events-bus.test.ts`（emit 事务性 / dispatcher fire-and-forget / buildMessage 各分支）
  - E2E：在 `tests/api/` 下加一条 `announcement-readonly-cross-role.spec.ts`，验证 SALES 用户直接 GET `/api/announcements/<admin-only-id>` 应得 404。

### [P1-5] `deleteMessage` 缺 audit log
- **文件**：`server/services/message.ts:44-48`
- **问题**：删一条站内信是用户级操作，从审计角度应留痕（哪条、什么时候删的）。当前 `audit.ts` 已经把 OperationLog 接入得很好（自动从 ctx 拿 IP/UA），公告 CRUD 都打了 audit，唯独消息删除没打。
- **建议**：
  ```ts
  await audit(prisma, {
    actorId: user.id,
    action: "MESSAGE_DELETE",
    entity: "Message",
    entityId: id,
    before: { title: m.title, type: m.type }
  });
  ```
  `markRead` / `markAllRead` 是否记审计建议按业务诉求定（高频操作记日志反而是噪音），但 `delete` 应当记。

### [P1-6] `announcement` update 无法清空 `effectiveFrom` / `effectiveTo`
- **文件**：`lib/validators/announcement.ts`、`server/services/announcement.ts:60-78`
- **问题**：
  - `announcementUpdateSchema = announcementCreateSchema.partial()`，`effectiveFrom` / `effectiveTo` 是 `isoDate.optional()`，即只能传 string 或 undefined；传 `null` 会被 Zod 拒掉（`z.iso.datetime()` 不接受 null）。
  - 但 service 层（line 72-73）明确支持 `null`（"传 null 是清空"）。API 与 service 的契约不一致。
  - 当前 UI 也没有提供"清空生效期"的入口，所以问题被掩盖。
- **建议**：把 validator 改为：
  ```ts
  effectiveFrom: z.iso.datetime().nullish(),
  effectiveTo: z.iso.datetime().nullish(),
  ```
  这样既能传 string 也能传 null（清空），undefined 跳过。同步把 `AnnouncementUpdateInput` 类型更新成 `string | null | undefined`。

---

## P2 改进

### [P2-1] `listAnnouncements` where 写法可读性 / 维护性
- **文件**：`server/services/announcement.ts:16-24`
- **问题**：
  ```ts
  const where: Prisma.AnnouncementWhereInput = {
    deletedAt: null,
    AND: [...],
    ...(keyword ? { OR: [...] } : {})
  };
  ```
  - 当前是合法的：top-level `AND` 与 top-level `OR` 都被 Prisma 隐式 AND，但读起来需要对照 Prisma 文档才能确认语义。
  - 一旦 `visibilityWhere` helper 抽出来后，list 调用应统一用：
  ```ts
  const where: Prisma.AnnouncementWhereInput = {
    AND: [
      { deletedAt: null },
      visibilityWhere(user),
      ...(keyword ? [{ OR: [{ title: { contains: keyword, mode: "insensitive" } }, { content: { contains: keyword, mode: "insensitive" } }] }] : [])
    ]
  };
  ```

### [P2-2] 公告无发布人外键 + 前端无发布人展示
- **文件**：`prisma/schema.prisma:320-335`、`app/(app)/announcements/page.tsx:48-91`
- **问题**：
  - schema 没有 `publishUser PublishUser @relation(...)`，只有 `publishUserId String`。Prisma 不会校验这个 id 是否真存在，删了用户后历史公告变成"幽灵公告"。
  - 前端表格列只展示标题、接收人、生效期、发布时间，**没有发布人列**，用户无法追溯是谁发的（操作日志里有，但要去翻日志）。
- **建议**：
  - schema 加 `publishUser PublishUser @relation(fields: [publishUserId], references: [id], onDelete: Restrict)`；migration 时若已有数据需要 backfill 校验。
  - `listAnnouncements` 用 `include: { publishUser: { select: { id, name } } }`；前端表格加一列"发布人"。
  - 关联后审计日志里 `actor` + 实体的 `publishUser` 可以联动展示。

### [P2-3] 公告 keyword 搜索无 trigram / 全文索引
- **文件**：`server/services/announcement.ts:23`
- **问题**：`{ contains: keyword, mode: "insensitive" }` 在 PG 上是 `ILIKE '%kw%'`，全表扫描。公告数据量小（一年内也就几百条）暂时 OK，但官方公告历史一长就会慢。
- **建议**：
  - PG：`CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE INDEX announcement_title_trgm ON "Announcement" USING gin (title gin_trgm_ops);`
  - 或者接 Meilisearch / 阿里云 OpenSearch（看部署成本）。

### [P2-4] `dashboard-shell` 标记已读失败时不提示
- **文件**：`components/dashboard-shell.tsx:626-630`
- **问题**：
  ```ts
  if (!m.readAt) {
    await fetch(`/api/messages/${m.id}`, { method: "PATCH", credentials: "include" });
    setUnread((u) => Math.max(0, u - 1));
  }
  ```
  - 没有 await 错误处理 / `res.ok` 判断。PATCH 失败时 `unread` 仍然 -1，UI 与服务端真实状态出现不一致。
- **建议**：包到 try/catch，失败时 `loadUnread()` 重新拉一次。

### [P2-5] `dashboard-shell` 用 `loadMessages` 拉列表但不标记已读
- **文件**：`components/dashboard-shell.tsx:251-259, 579-660`
- **问题**：打开抽屉后看到一堆消息，但点进具体条目才标记已读；如果用户只是"扫一眼"，未读 badge 不会减少。竞品（钉钉/企微）一般"抽屉打开即视为已读"或"展开 1s 后标记已读"。
- **建议**：在抽屉打开 N 秒后批量调用 `markAllRead`；或者当条消息进入视口时自动 PATCH。建议先与产品确认 UX 取向再改。

### [P2-6] 公告 PATCH 时未校验 `effectiveFrom <= effectiveTo`
- **文件**：`lib/validators/announcement.ts`
- **问题**：create / update 都没做范围校验。可以传 `effectiveFrom=2027-01-01, effectiveTo=2026-01-01`，DB 不报错，前端就显示一条"永远不在生效期"的公告（list 过滤掉了所以对用户隐形，但发布人自己能看到，全员不可见，挺迷惑）。
- **建议**：加 `.refine((d) => !d.effectiveFrom || !d.effectiveTo || new Date(d.effectiveFrom) <= new Date(d.effectiveTo), { message: "生效期起止必须合法" })`。

### [P2-7] `bus.ts:buildMessage` 的 default case 用 `JSON.stringify(p)` 兜底
- **文件**：`server/events/bus.ts:169-170`
- **问题**：
  ```ts
  default:
    return { receiverUserId: uid, title: "通知", content: JSON.stringify(p) };
  ```
  - 新加 `DomainEventType` 后忘了加 `case`，会走到这里，把整个 payload dump 给用户。
  - JSON.stringify 序列化 Prisma 对象时如果带 `Decimal` / `Date` / `BigInt` 会得到奇怪的字符串；循环引用会抛。
- **建议**：改为 `throw new Error(\`[bus] unhandled event type: ${ev.type}\`)`，强制实现；或在 `DomainEventType` 上加 `assertNever(ev.type)`。

### [P2-8] `dispatcher` fire-and-forget 失败无可观测性
- **文件**：`server/events/dispatcher.ts:127-133`
- **问题**：邮件/企微发送失败只 `console.warn`，没有重试、没有指标、没有入 OperationLog。生产环境如果 SMTP 挂了管理员不会立刻知道。
- **建议**：
  - 把失败写到 `NotifyFailureLog` 表（schema 新增）+ 邮件告警管理员。
  - 用现成的 `OperationLog` 加 `entity: "NotifyChannel"` + `status: "FAILURE"` 也行。
  - 简单方案：暴露 `GET /api/admin/notify-failures`（ADMIN only）展示最近 24h 失败记录。

### [P2-9] `notify-config.ts` 的 `channelsByType` 没有覆盖全部 `DomainEventType`
- **文件**：`lib/notify-config.ts:30-42`、`server/events/bus.ts:7-22`
- **问题**：
  - `bus.ts` 定义了 15 种 `DomainEventType`；
  - `notify-config.channelsByType` 只配了 11 种；
  - 缺：`CONTRACT_AUTO_EXECUTED`、`CONTRACT_AUTO_COMPLETED`、`CONTRACT_AUTO_EXPIRED`、`ASSET_EXPIRING`、`PROJECT_DUE`（实际有，但 channel 配置缺）。
  - `dispatcher.ts:101` 用 `?? ["inbox"]` 兜底，导致这些类型只走 inbox。
  - 注释说"全 0 件 skip"，但漏配 = 静默行为改变。
- **建议**：要么在 channelsByType 显式列全部 15 种，要么用 `satisfies Record<DomainEventType, NotifyChannel[]>` 让 TS 强制覆盖完整。

### [P2-10] i18n 未应用
- **文件**：`app/(app)/announcements/page.tsx`、`app/(app)/messages/page.tsx`、`components/dashboard-shell.tsx`
- **问题**：所有 UI 文案（标题/按钮/列名/empty 文案）硬编码中文。`lib/i18n.ts` 已经有 `useT()` 工具，但没人用。
- **建议**：P5 起把页面文案抽到 `messages/zh-CN.json` / `en-US.json`；优先在 `messages/page.tsx` 试点（行数少、复用高）。

### [P2-11] `announcement` / `message` schema 层无字段长度限制
- **文件**：`prisma/schema.prisma:306-335`
- **问题**：`Message.title String`、`Message.content String`、`Announcement.title String`、`Announcement.content String` 都是无长度上限的 `text`。前端/zod 限制 200/10000，但任何人绕过 API 直接写 DB 就可以超长（脏数据 / 渲染性能问题）。
- **建议**：用 `@db.VarChar(N)` 显式约束；migration 已经做过的数据不会重写。

---

## 做得好的地方（保留）

1. **inbox 与外部通道职责分离**：inbox 在事务内（保证与业务状态机迁移原子），email/wechat fire-and-forget（不影响主流程）。`bus.emit` 注释清晰说明了设计意图。
2. **去重机制完备**：`contractExpiringJob` / `customerInactiveJob` / `tickCustomerStatusSuggestions`(后两者 v0.5.0 随客户状态机下线而删)都用 `type + entityId + 当天` 三个维度去重，避免每天给同一用户刷 10 条同样的提醒。
3. **markRead 幂等**：已读后再 PATCH 不重写 `readAt`（`message.ts:31`）。
4. **markAllRead 用 updateMany**：避免 SELECT + 多次 UPDATE 的循环。
5. **公告目标角色 + 生效期都在 SQL 过滤**：避免前端再过滤或漏过滤。
6. **审计自动从 ctx 拿 IP/UA**：`audit.ts:82-98` 读 `getRequestContext()`，service 层不用每次塞 IP，重复代码少。
7. **审计敏感字段脱敏**：`audit.ts:32-45` 有 `SENSITIVE_KEYS` set + `redact()`，加上 `AUDIT_FULL_PAYLOAD=false` 的部署选项。
8. **message-link 抽取**：`lib/message-link.ts` 把"link.kind → 路径"的映射抽出来，`dashboard-shell.tsx` 与 `messages/page.tsx` 复用，避免两处拼 URL 漂移。
9. **query boolean 处理规范**：`app/api/messages/route.ts:11-14` 显式 z.enum + transform，避免 `z.coerce.boolean()` 把 `"false"` 也当 true 的坑。
10. **targetRoles 为空 = 全员**：约定直观，写在 schema 注释里。
11. **`customer-status-suggest` 单测**（v0.5.0 随客户状态机下线而删）：曾覆盖规则 1、规则 2、SQL 预过滤、去重四个场景，是 job 类代码的好范例。
12. **`kindToPath` 用 `${base}` 而非裸路径**：邮件 / 企微跳转带绝对 URL，避免邮件里点击相对路径 404。
13. **运营日志/审计入口稳定**：公告 CRUD 都打了 audit（包括 before/after 最小集），符合"谁在什么时候改了什么"的可追溯要求。
14. **listAnnouncements 多 OR 用 Prisma 顶层 AND 嵌套**：与 `WHERE deletedAt IS NULL AND ...` 语义一致，行为正确。

---

## 修复优先级建议

| 优先级 | 编号 | 一句话总结 | 估计工时 |
|---|---|---|---|
| P0-1 | 越权读公告 | 抽 visibilityWhere helper | 1h |
| P0-2 | emit N+1 写 | 改 createMany + 加注释 | 30min |
| P0-3 | dispatcher 死代码 | 删 TYPE_TO_TEMPLATE | 15min |
| P1-1 | unread 轮询性能 | 加 unread-count 端点 + SWR | 4h |
| P1-2 | URL map 双份 | 抽 buildAbsoluteLinkHref + 补 project/asset | 2h |
| P1-3 | link Zod 缺失 + suggest 字段丢失 | 写 messageLinkSchema + 修 buildMessageLinkHref | 4h |
| P1-4 | 业务层单测 | 补 message/announcement/events-bus 测试 | 1d |
| P1-5 | 删消息缺审计 | 加 audit 调用 | 15min |
| P1-6 | 生效期清空 API 不通 | validator 改 nullish | 15min |
| P2-* | 各项改进 | 见上文 | 1-2d |