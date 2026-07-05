钉第三方登录设计

| 项 | 值 |
| --- | --- |
| 日期 | 2026-07-05 |
| 状态 | 待 review |
| 范围 | 在现有 `CredentialsProvider` 登录旁新增**钉第企业内自建应用扫码登录**；工号+密码登录保留且不受影响 |
| 目标版本 | qt-biz v0.9.x |
| 落地策略 | **一次性切换**（不分灰度，无 feature flag） |

## 1. 背景与目标

### 1.1 现状速记

- NextAuth v4 + JWT + `CredentialsProvider`，会话 7 天 / 8 小时双档（`lib/auth.ts` 里的 `encode` 自定义）。
- `User` 表字段：`id / employeeNo / name / email / phone / passwordHash / roleId / ... / status / wechatWorkId`，**无 `Account/Identity/Provider` 子表**（即未启用 `PrismaAdapter`）。
- 角色解析走 `loadActiveUser(uid)` 缓存（5s TTL）→ `prisma.user.findFirst({ include: { role: { select: { code: true } } } })` → `ROLE_PERMISSIONS` 硬编码。
- 登录页 `app/login/page.tsx`：工号+密码 + 5 个 dev 快速填充卡 + 错误码 `ERROR_MAP`；登录成功调 `signIn("credentials", ...)` 走 NextAuth；登录后跳 `safeCallbackUrl(search.get("callbackUrl"))`。
- 已有 `wechatWorkId: String?` 列、`OperationLog(entity/action/...)` 审计、`runWithRequestContext` ALS 上下文、`use-action-call` 客户端调用模板。
- 仓库内**完全没有** `dingtalk` / `oauth` / `sso` 关键字。

### 1.2 目标

1. 登录页同时提供「工号+密码」与「钉第扫码」两种入口，**互不强制**：
   - 不绑钉第也能继续密码登录；
   - 绑了钉第也能继续密码登录；
   - 第一次扫码时由系统按钉第 `mobile` 自动绑定到现有 `User`，之后扫码即登。
2. 复用现有 NextAuth JWT 与 `loadActiveUser` 缓存路径，**角色 / 权限 / 会话策略不变**。
3. env 缺钉第配置时登录页**自动隐藏**钉第入口，密码登录照常（与 `isMinioEnabled()` 同样的「能力开关」模式）。

### 1.3 非目标（明确不做）

- **不**做解绑 UI（`UserIdentity` 已支持后续扩展，但本期不开放入口）。
- **不**做 admin 强制解绑、unionid 迁移、跨 corpId 切换。
- **不**做企业外部扫码（客户/供应商用钉第进入业务系统）。
- **不**改动 `User.role` 解析路径，钉第登录**不**改变 `roleCode`。
- **不**新增 Redis 等中间件——临时码用 Prisma 表存。
- **不**改登录页主样式、narrative、dev 快速填充卡。

## 2. 整体方案

### 2.1 流程总览

```
[登录页] 点「钉第登录」 → 调 GET /api/auth/dingtalk/qrcode
                          ↓
                服务端：拿 access_token → 调钉第获取二维码
                内部生成 state(32B) 写库(状态 PENDING, 180s TTL)
                          ↓
[登录页] 渲染二维码 + 起 setInterval 1.5s
                          ↓
                调 GET /api/auth/dingtalk/poll?state=...
                          ↓
                查库：状态仍 PENDING → 返回 { status: PENDING }
                      状态变 CONFIRMED → 用 authCode 换 unionid/mobile
                      落库状态 READY → 返回 { status: READY }
                          ↓
[登录页] 收到 READY → clearInterval + POST /api/auth/dingtalk/finish
                          ↓
                服务端：
                - unionid 查 UserIdentity → 命中 → loadActiveUser 签 JWT
                - 未命中 → 用 mobile 查 User.phone（唯一）：
                    * 1 个 → 事务内 insert UserIdentity + 更新 User.dingtalkBoundAt
                    * 0 个 → 401 DINGTALK_PHONE_NOT_REGISTERED
                    * ≥2 个 → 401 DINGTALK_PHONE_AMBIGUOUS (理论不发生)
                - 写 OperationLog (action=dingtalk_bind 首次 / dingtalk_login 后续)
                - 用 next-auth/jwt encode 与现有 CredentialsProvider 完全相同的 token payload
                - setCookie(next-auth.session-token, ...) 与密码登录共用同一 cookie 名
                          ↓
[登录页] router.push(callbackUrl) + router.refresh()  ← 完全复用现有逻辑
```

### 2.2 关键决策

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| Provider 类型 | **不**用 `next-auth/providers/dingtalk` 第三方库 | NextAuth v4 没有官方 Provider，社区方案都是 OAuth 跳转式，与本期"内嵌二维码"不兼容 |
| 二维码形态 | **服务端生成临时码 + 前端用 qrcode.react/canvas 渲染** | 与 NextAuth OAuth 跳转路径解耦，登录页体验更顺 |
| 状态推进 | **服务端主动轮询钉第 `getUserInfoByTmpCode` 风格接口**（视开放能力定；备选 webhook） | 不依赖前端直连钉第，避免 CORS / 凭证外泄 |
| 临时码存储 | **新增 `DingtalkLoginCode` Prisma 表**（180s TTL + 一次性消费） | 仓库内无 Redis 依赖；与现有 cron 清理模式一致 |
| 绑定关系存储 | **新增 `UserIdentity` 表** + `User.dingtalkBoundAt` 审计字段 | 1 User 后续可挂多个 Provider；不解绑 User 即可废二维码 |
| 角色 / 权限路径 | **完全复用** `loadActiveUser` + `ROLE_PERMISSIONS` | 零行为偏差，5s TTL 缓存、admin 禁用/改角色立即失效逻辑都不动 |
| 错误码 | **新增** `DINGTALK_PHONE_NOT_REGISTERED` / `DINGTALK_PHONE_AMBIGUOUS` / `DINGTALK_QR_EXPIRED` / `DINGTALK_BIND_RACE` | 沿用现有 `ERROR_CODES` 风格 |
| env 模式 | **`DINGTALK_APP_KEY/SECRET` 缺即视为钉第登录未启用** | 与 `isMinioEnabled()` 同模式；启动期不 fail-fast |
| 同账号多端 | **共用 NextAuth JWT 单 cookie**：新登录顶掉旧会话 | 与密码登录现状一致，零特例 |
| 重复绑定保护 | `UserIdentity @@unique([provider, providerUserId])` | 并发 / 重复请求由 DB 兜底 |
| 操作审计 | `OperationLog` 增 `dingtalk_bind` / `dingtalk_login` action | 沿用 `audit()` ALS 上下文，IP/UA 自动写入 |
| 测试 | Vitest 单测钉第 4 个接口 mock + Playwright `route()` 拦截 | CI 沙箱无外网，不打真钉第 |

## 3. 数据模型

### 3.1 新表：`UserIdentity`

```prisma
model UserIdentity {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  provider        String   // DINGTALK | (预留 WECHAT_WORK / FEISHU / ... )
  providerUserId  String   // 钉第 unionid；后续可扩展
  // 绑定时的快照,用于审计/解绑提示,真实 mobile/email 仍以 User 表为准
  mobileSnapshot  String?
  unionidSnapshot String?
  boundAt         DateTime @default(now()) @db.Timestamptz(6)
  boundBy         String   // SELF 扫码自助 | ADMIN 后台 | MIGRATION 数据迁移
  // 单 Provider 同一 unionid 全局唯一;一个 User 可挂多个 Provider 不同行
  @@unique([provider, providerUserId])
  @@index([userId])
  @@map("user_identities")
}
```

- **末尾必须追加** `GRANT ALL ON TABLE "user_identities" TO qt_app;`（v0.7.0 `DunningNote` 教训，`@auth/prisma-adapter` 已装但未启用）。
- 关系：`User` 加 `identities UserIdentity[]`（反向）。

### 3.2 `User` 字段追加

```prisma
model User {
  // ... 现有字段 ...
  dingtalkBoundAt  DateTime?  @db.Timestamptz(6)
  identities       UserIdentity[]
  // ... 现有 index 不动
}
```

仅作审计/列表展示冗余，**不**参与登录判定（登录判定只看 `UserIdentity`）。

### 3.3 新表：`DingtalkLoginCode`

```prisma
model DingtalkLoginCode {
  id             String   @id @default(cuid())
  state          String   @unique     // 服务端生成 32B 随机 (base64url)
  tmpCode        String                // 钉第返回的 tmpCode,扫码确认前不消费
  // 状态机: PENDING -> CONFIRMED -> READY -> CONSUMED | EXPIRED
  status         String   @default("PENDING")
  unionid        String?               // CONFIRMED 后写入
  mobile         String?               // READY 后写入
  nick           String?
  employeeNoHint String?               // 备用,本期未用,留作未来 B 路径(输工号确认)
  ip             String?
  userAgent      String?
  expiresAt      DateTime @db.Timestamptz(6)
  consumedAt     DateTime? @db.Timestamptz(6)
  consumedById   String?               // User.id,落库后写
  createdAt      DateTime @default(now()) @db.Timestamptz(6)

  @@index([status, expiresAt])
  @@index([createdAt])
  @@map("dingtalk_login_codes")
}
```

迁移命名：`prisma/migrations/20260705_dingtalk_login/`

## 4. 接口设计

### 4.1 `GET /api/auth/dingtalk/qrcode`

- 鉴权：同源（Next.js Route Handler 天然）；无 cookie 态。
- 流程：
  1. 检查 `isDingtalkEnabled()`（`DINGTALK_APP_KEY && DINGTALK_APP_SECRET` 都存在），缺则 **503** + `DINGTALK_NOT_CONFIGURED`。
  2. `getDingtalkAccessToken()`：内存缓存，TTL 7000s（钉第 7200s 留 200s 缓冲），按 `appKey` 索引；miss 时调 `https://oapi.dingtalk.com/gettoken?appkey=...&appsecret=...` 拿 `access_token`。
  3. 调钉第「扫码登录 - 获取二维码 URL」拿到 `{ tmpCode, expiresIn }`（具体 endpoint 在实现期按钉第 OpenAPI 当前文档确认；若返回 png 二进制，base64 后返回）。
  4. 生成 `state = base64url(crypto.randomBytes(32))`，写 `DingtalkLoginCode { state, tmpCode, status: PENDING, expiresAt: now + 180s, ip, userAgent }`。
  5. 返回 `{ qrcodeUrl, state, expiresIn, pollIntervalMs: 1500 }`。
- 错误：钉第调用失败 → **502** + `DINGTALK_UPSTREAM_ERROR`（前端展示「钉第服务暂不可用」）。

### 4.2 `GET /api/auth/dingtalk/poll?state=...`

- 鉴权：同源；`state` 必填。
- 流程：
  1. `prisma.dingtalkLoginCode.findUnique({ where: { state } })`；不存在 → 404 `DINGTALK_STATE_NOT_FOUND`。
  2. `now > expiresAt` → 返回 `{ status: EXPIRED }`（HTTP 200，不报错，前端收到后停止轮询）。
  3. `status === PENDING`：调钉第「查询扫码状态」接口（用 `tmpCode` 问「是否已确认」），按返回推进：
     - 未扫码 → `{ status: PENDING }`。
     - 已扫码待确认 → `{ status: PENDING, hint: WAITING_CONFIRM }`。
     - 已确认拿到 `authCode` → 调 `https://oapi.dingtalk.com/topapi/v2/user/getuserinfo?access_token=...&code=...` 拿 `userid`（即 unionid），再调 `https://oapi.dingtalk.com/topapi/v2/user/get?access_token=...&userid=...` 拿 `mobile / nick`。事务内把 `DingtalkLoginCode` 改 `status=READY, unionid, mobile, nick`。
     - 用户取消 → `{ status: CANCELLED }`，前端停止轮询 + 提示「已在手机上取消」。
  4. `status === READY` → 直接返回 `{ status: READY }`（包含 `unionid/mobile/nick` 不在响应体里——前端只触发 finish，避免信息泄露）。
  5. `status === CONSUMED` → `{ status: CONSUMED }`（防前端在 finish 成功后又轮询到旧数据）。
- 错误：upstream 失败 → 返回 `PENDING` 不报错（前端继续轮询），**仅在控制台记一条 `OperationLog(status=FAILURE, action=dingtalk_poll)` 便于排错**。

### 4.3 `POST /api/auth/dingtalk/finish`

- 鉴权：同源 + `state` 入参；`content-type: application/json`。
- 入参：`{ state }`。
- 流程：
  1. 库内 `state` 行必须存在且 `status=READY`，否则 410 / 401 区分错误码：
     - 不存在 → 404 `DINGTALK_STATE_NOT_FOUND`
     - `EXPIRED` → 410 `DINGTALK_QR_EXPIRED`
     - `CONSUMED` → 409 `DINGTALK_STATE_CONSUMED`
     - `PENDING/CANCELLED` → 409 `DINGTALK_STATE_NOT_READY`
  2. **关键：消费时用 `update` 带 `where: { state, status: READY }` + 乐观锁**（`AND status = READY` → `status: CONSUMED, consumedAt, consumedById`），**只允许 1 个请求成功**；并发赢家继续，输家收到 409。
  3. 用 `unionid` 查 `UserIdentity`：
     - 命中 → 取 `userId`，往下走「签发 JWT」分支。
     - 未命中 → 用 `mobile` 查 `User.phone`：
       - **恰好 1 个**（预期）：事务内 `create UserIdentity { provider: DINGTALK, providerUserId: unionid, mobileSnapshot, unionidSnapshot, boundBy: SELF }` + `User.update { dingtalkBoundAt: now }`。
       - **0 个**：回滚事务（已经改的 status=CONSUMED 用单独 update 不在事务内更稳，方案见下）→ 401 `DINGTALK_PHONE_NOT_REGISTERED`。
       - **≥2 个**：理论上 `User.phone` unique 不应发生，**不**为这种异常多写代码——同样返 401 `DINGTALK_PHONE_AMBIGUOUS`，OperationLog FAILURE 让管理员排查。
  4. **事务边界**（钉死，避免实现期做错）：`status=CONSUMED` **不**进 `UserIdentity` 事务；顺序是
     1) `prisma.$transaction([create UserIdentity, update User.dingtalkBoundAt])`
     2) 事务成功 → 立刻 `update DingtalkLoginCode { where: { state, status: READY }, data: { status: CONSUMED, consumedAt, consumedById } }`
     3) 事务失败 → **不**动 `DingtalkLoginCode`（仍是 `READY`，前端可重试 `finish`）
     4) `DINGTALK_USER_DISABLED` / `DINGTALK_PHONE_NOT_REGISTERED` 同样不置 `CONSUMED`（前者凭证一次性，后者让用户换号重扫）
  5. **唯一例外**：`loadActiveUser` 返 null（user 已被禁用）时**仍**置 `CONSUMED`（§9 风险缓解：不让攻击者拿同一 unionid 无限重试）
  6. 拿到 `user.id` 后走 `loadActiveUser(uid)`：
     - `null`（被禁用 / 删除）→ 401 `DINGTALK_USER_DISABLED`，**不**回退 CONSUMED（一次性凭证，避免凭据被劫持后无限重试）。
     - 通过 → `audit({ actorId: user.id, action: dingtalk_login, entity: User, entityId: user.id })`；**首次绑定**再写一条 `action=dingtalk_bind`。
  7. **签发 JWT**（与 Credentials 路径同源）：
     ```ts
     const token = await encode({
       token: { uid: user.id, employeeNo, roleCode, remember: true },
       secret: env.NEXTAUTH_SECRET,
       maxAge: 7 * 24 * 60 * 60,
     });
     ```
     cookie 名为 `next-auth.session-token`（生产 `__Secure-next-auth.session-token`，由 NextAuth 自动选），`httpOnly`、`sameSite=lax`、`path=/`、7d。**完全**用 NextAuth 现有 `setCookie` 行为，避免双 cookie 体系。
  8. 返回 `{ ok: true, redirectTo: callbackUrl ?? /dashboard }`。

### 4.4 `POST /api/auth/dingtalk/cancel`（前端主动停轮询时调用）

- 入参：`{ state }`。
- 行为：`update where: { state, status: PENDING } → status: EXPIRED`（不影响正在被消费或已消费的）。
- 失败/不存在 → 静默 200。

### 4.5 env 配置

`lib/env.ts` 追加（沿用「能力开关」模式，不强制生产配置）：

```ts
DINGTALK_APP_KEY: z.string().min(1).optional(),
DINGTALK_APP_SECRET: z.string().min(1).optional(),
DINGTALK_LOGIN_SCOPE: z.string().min(1).default("snsapi_login"),
```

`runtimeEnv` 同步加 3 个键。导出辅助：

```ts
export function isDingtalkEnabled(): boolean {
  return Boolean(env.DINGTALK_APP_KEY && env.DINGTALK_APP_SECRET);
}
```

`.env.example` 追加注释（**不**写真值），说明如何从钉第开发者后台拿 `AppKey/AppSecret`。

## 5. 鉴权 / 角色 / 缓存复用

- `loadActiveUser(uid)` **不动**。钉第登录在 `finish` 拿到 `user.id` 后走的就是它：`prisma.user.findFirst({ where: { id, deletedAt: null, status: ACTIVE, isSystem: false }, select: { id, employeeNo, role: { select: { code: true } } } })`。
- 5s TTL `userCache` 同样不动；`invalidateAuthCache(uid)` 钩子同样不动。
- 角色 / 权限矩阵 `ROLE_PERMISSIONS` **不动**。
- **唯一新增的代码路径**：`lib/dingtalk.ts`（服务端 SDK 封装）+ `app/api/auth/dingtalk/*` 4 个 route + `app/login/page.tsx` 二维码面板。

## 6. 审计与可观测

### 6.1 `OperationLog` 写入点

| 触发 | actorId | entity | action | 失败场景 |
| --- | --- | --- | --- | --- |
| 钉第首次绑定 | 登录人 user.id | `User` | `dingtalk_bind` | unionid 唯一冲突 → 视为已绑定，重试 finish |
| 钉第登录 | 登录人 user.id | `User` | `dingtalk_login` | user 已被禁用 |
| 钉第轮询失败 | null | `DingtalkLoginCode` | `dingtalk_poll` | upstream 网络错误 |
| 钉第未注册手机号 | null | `DingtalkLoginCode` | `dingtalk_bind` | status=FAILURE，message=未注册 |

通过 `lib/audit.ts` 的 `audit()` 函数 + `runWithRequestContext` 自动写入 IP/UA/method/path，**不**手动塞字段。

### 6.2 日志

- `lib/dingtalk.ts` 内每次调钉第 upstream 用 `console.debug([dingtalk] ..., { endpoint, costMs, status })`，`env.NODE_ENV !== production` 才打。
- 出错走 `console.error`，级别靠 pino 之类的留作后续工作，本期不加。

## 7. 错误码

在 `lib/api-error.ts`（或现有 `ERROR_CODES` 常量）追加：

| code | HTTP | 含义 |
| --- | --- | --- |
| `DINGTALK_NOT_CONFIGURED` | 503 | env 缺 `DINGTALK_APP_KEY/SECRET` |
| `DINGTALK_UPSTREAM_ERROR` | 502 | 钉第 upstream 调用失败 |
| `DINGTALK_STATE_NOT_FOUND` | 404 | state 不存在 |
| `DINGTALK_QR_EXPIRED` | 410 | 二维码超过 180s |
| `DINGTALK_STATE_NOT_READY` | 409 | 用户还没在手机上点确认 |
| `DINGTALK_STATE_CONSUMED` | 409 | 同一 state 已被消费 |
| `DINGTALK_PHONE_NOT_REGISTERED` | 401 | 钉第 mobile 在本系统 User.phone 里 0 个匹配 |
| `DINGTALK_PHONE_AMBIGUOUS` | 401 | 命中多个（理论不应发生） |
| `DINGTALK_USER_DISABLED` | 401 | 匹配到 User 但 status=DISABLED / deleted |

## 8. 前端改造

### 8.1 `app/login/page.tsx`

在 `<form>` 之后、`footer` 之前插入「分隔线 + 钉第登录面板」：

- 默认渲染**一个 Button**「使用钉第扫码登录」（用 `@ant-design/icons` 的 `QrcodeOutlined`，若库内没这个 icon 用 `ScanOutlined`，需查 `node_modules/@ant-design/icons`）。
- 点击后调 `GET /api/auth/dingtalk/qrcode`，成功后把按钮替换成「二维码卡片」：`<img src={qrcodeUrl}>`（若 upstream 直接给 png）或 `<canvas>`（用 `qrcode` npm 包在前端把 `qrcodeUrl` 渲染为 canvas，**优先 npm 方案**减少 upstream 依赖）。
- 起 `setInterval(poll, 1500)`，handle：
  - `PENDING` → 继续
  - `EXPIRED` → 清 timer + 提示「二维码已过期，请点击刷新」
  - `CANCELLED` → 清 timer + 提示「已在手机上取消」
  - `READY` → 清 timer + `await finish({ state })` + `router.push(redirectTo)` + `router.refresh()`
- 「刷新二维码」按钮复用 qrcode 接口，重新走一遍 4.1。
- dev 环境下若 `DINGTALK_APP_KEY/SECRET` 未配，前端组件用 `useSWR(/api/auth/dingtalk/enabled, ...)` 或在 SSR 时直接 `isDingtalkEnabled()` 渲染时隐藏整个面板（与 MinIO 检查一致）。

### 8.2 i18n

`lib/i18n/zh-CN.ts` + `en-US.ts` 追加：

```
"login.dingtalk.button": "使用钉第扫码登录" / "Sign in with DingTalk"
"login.dingtalk.qrHint": "请用钉第 App 扫一扫" / "Scan with DingTalk"
"login.dingtalk.expired": "二维码已过期，请点击刷新" / "QR code expired, please refresh"
"login.dingtalk.cancelled": "已在手机上取消登录" / "Login cancelled on phone"
"login.dingtalk.unbound": "该钉第账号未关联系统用户，请联系管理员" / "This DingTalk account is not linked. Please contact your administrator."
"login.dingtalk.unavailable": "钉第登录暂不可用" / "DingTalk login is currently unavailable"
```

## 9. 安全考量

| 风险 | 缓解 |
| --- | --- |
| state 暴力枚举 | 32 字节 `crypto.randomBytes` (base64url = 43 字符)，180s TTL，写库 + `@@unique`；攻击面 ≈ 0 |
| `state` 跨用户盗用 | 用户 A 拿 `state` 给 B → B 看到的仍是自己 `User.phone` 匹配的 user，无横向提权 |
| QR 截图攻击 | 用户 A 截屏二维码 → B 扫 → `tmpCode` 仍指向 A 的会话，B 完成 finish 拿到 A 的 user；这是扫码登录的固有特性，**不**做地理/IP 限制，文档中提示管理员 |
| CSRF on `/finish` | 同源 + SameSite=Lax cookie，且 `finish` 之前没有 session 态（QR 是无 cookie 拉起的）；加 `Origin` 头校验作为纵深防御 |
| 并发 finish | 乐观锁 `where status=READY` 只允许 1 次 `CONSUMED` 更新 |
| 钉第 upstream 凭证泄露 | `DINGTALK_APP_SECRET` 仅服务端使用，`runtimeEnv` 不会进 `NEXT_PUBLIC_*` |
| `UserIdentity` 越权写 | 唯一入口是 `finish` 内的服务端事务；不走任何用户输入直接 create |
| 重复扫码同一 unionid | `@@unique([provider, providerUserId])` 兜底，重复时 `try { create } catch (P2002) { 视为已绑定 }` |
| 凭证劫持 → user 已禁用 | 仍然 CONSUMED（不让反复重试），便于排查而非纵容攻击 |
| 旧二维码被新状态顶掉 | `state` 全局唯一，不复用；旧 `state` 走 EXPIRED 路径 |

## 10. 测试

### 10.1 Vitest 单测

`tests/api/dingtalk-login.test.ts` 覆盖（mock `lib/dingtalk.ts` 的 4 个 upstream 调用）：

1. 缺 env → 503 `DINGTALK_NOT_CONFIGURED`
2. 拉二维码成功 → 写库 `DingtalkLoginCode { status: PENDING }` → 返回 `qrcodeUrl + state`
3. 轮询 `PENDING` → 仍 `PENDING`；`expiresAt` 过期 → `EXPIRED`
4. 轮询到 READY（upstream mock 返回 `authCode` → `unionid+mobile`）→ 状态推进
5. `finish` + `unionid` 未绑 + `User.phone` 命中 1 个 → 事务内创建 `UserIdentity` + `User.dingtalkBoundAt` + 签 JWT + set cookie
6. `finish` + `unionid` 未绑 + `User.phone` 0 个 → 401 `DINGTALK_PHONE_NOT_REGISTERED`，**不**消耗 READY
7. `finish` + `unionid` 已绑 → 直接签 JWT
8. 并发 finish（`Promise.all([finish, finish])`）→ 1 成功 1 返 409
9. user 被禁用 → 401 `DINGTALK_USER_DISABLED` 且 `CONSUMED`（防重试）

### 10.2 Playwright E2E

`tests/e2e/16-dingtalk-login.spec.ts`：

- `page.route(https://oapi.dingtalk.com/**, mockHandler)` 拦截所有钉第 upstream，按 state 切换返回值。
- 流程：访问 `/login` → 点「钉第登录」 → 看到二维码 → mock「确认」 → 等待跳转 `/dashboard`。
- 反向流程：mock `unionid.mobile` 不在 `User.phone` → 看到「未关联系统用户」红色提示。
- 串到 `auto-login.spec.ts` 验证：钉第登录拿到 cookie 后刷新页面仍是登录态。

### 10.3 手测 checklist（PR 描述里贴）

- [ ] dev 环境未配 `DINGTALK_APP_KEY/SECRET` → 登录页**完全**不显示钉第入口
- [ ] dev 环境配好 → 扫码登录 5 个 dev 账号之一成功跳 `/dashboard`
- [ ] 用未注册的钉第账号扫码 → 看到「未关联」提示
- [ ] 故意把 `DingtalkLoginCode.expiresAt` 改到过去 → 重轮询立刻返 `EXPIRED`
- [ ] admin 在后台把某 dev 账号禁用 → 该账号钉第登录返 `DINGTALK_USER_DISABLED`
- [ ] `OperationLog` 表出现 `dingtalk_bind`（首次）和 `dingtalk_login`（后续）记录

## 11. 部署 / 迁移 / 配置

### 11.1 迁移

- 新建 `prisma/migrations/20260705_dingtalk_login/migration.sql`（手工写）：
  - `CREATE TABLE "user_identities" ...`
  - `ALTER TABLE "User" ADD COLUMN "dingtalkBoundAt" ...`
  - `CREATE TABLE "dingtalk_login_codes" ...`
  - 末尾追加 `GRANT ALL ON TABLE "user_identities" TO qt_app;`、`GRANT ALL ON TABLE "dingtalk_login_codes" TO qt_app;`（v0.7.0 教训）。
  - **同时**：`ALTER TABLE "User" ALTER COLUMN "phone" SET NOT NULL;` + `CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");`（§12 强制约束）。
- **禁止**用 `prisma migrate dev`（AGENTS.md 已强调），统一 `npm run prisma:deploy`。
- 本地开发新拉代码后跑 `npm run prisma:deploy` 应用。

### 11.2 env

- `.env.example` 追加注释段：「钉第企业内自建应用登录（可选；缺则登录页隐藏钉第入口）」+ 申请链接 `https://open-dev.dingtalk.com/`。
- 生产部署文档 `docs/阿里云 ECS 单主机部署方案 — qt-biz v0.1.0.md` 增补一节「钉第登录配置」，位置不影响现有结构。

### 11.3 清理 cron

`lib/jobs/cleanExpiredDingtalkCodes.ts`：每天 04:30 跑（与 `cleanExpired*` 同窗口），删 `status IN (PENDING, EXPIRED) AND expiresAt < now - 1d` 的行，限 1000 行/次。注册到 `lib/jobs/index.ts` 的 `runAllJobs()`。

## 12. 风险与回滚

- **强制约束**：`User.phone` 必须在本次迁移里 `ALTER COLUMN "phone" SET NOT NULL` 且 `CREATE UNIQUE INDEX`（当前 schema 是 `String?` 缺 unique，AGENTS.md v0.7.0 教训同 `customer.code`）。本期实现**首件事**就是这条，否则 `DINGTALK_PHONE_AMBIGUOUS` 真的可能触发。

- **回滚**：`prisma migrate deploy` 不支持自动回滚，本期如需紧急回滚：
  1. 把登录页钉第面板用 `isDingtalkEnabled()` 隐藏（删 env 即可）。
  2. 不删表 / 不删列（保留 `user_identities` 与 `dingtalkBoundAt`，对运行零影响）。
- **风险点 1**：钉第 OpenAPI 文档变动 → 实现期必须用最新官方文档确认 endpoint；spec 中不写死具体 URL，统一从 `lib/dingtalk.ts` 的常量出。
- **风险点 2**：`User.phone` 不唯一 → 强约束 `@@unique`（现有 schema 中 phone 是 `String?` 缺 unique，需在迁移里**显式加 unique** —— 同 v0.7.0 `customer.code` 加 unique 模式）。**不**允许「User.phone 可能多个」的设计存在。
- **风险点 3**：扫码登录要求员工钉第 `mobile` 与系统 `User.phone` 一致；如有历史数据不一致，PR 描述里要明确「需要管理员先在用户管理里把 phone 改成钉第登记的号」。

## 13. 不在范围

- 钉第扫码绑定到**外部协作者**（客户/供应商）
- 扫码后**多因子**（短信二次验证）
- **多 corpId** 支持（一个企业一个 corpId 就够）
- 钉第「工作台免登」（扫码进入具体业务页面）
- 解绑 UI / 改绑 UI

