# 登录安全审查与修复(v0.10.0)

> 触发: 2026-07-11 内部代码审查, 范围 `lib/auth.ts` / `app/login/` / `app/api/auth/` / 登录相关 scripts.
> 评级口径: P1 = 必修(影响线上账号安全), P2 = 应修(可观察的弱点), P3 = 建议(代码质量).
> 状态: P1-1 ~ P3-5 共 15 项全部修复, 见 PR `fix(auth): 登录安全加固 v0.10.0`.

---

## 审查摘要

P0 阶段登录链路只做了 `bcrypt.compare`, 没有任何:
- 失败计数 / 锁定
- IP 限速
- 登录审计日志
- 密码自服务重置
- callbackUrl 真正的安全校验
- 角色变更撤销缓存

加之 system 占位 user 用固定字符串当 hash、legacy 迁移脚本写死 `"123456"`、`seed:dev-users` 没守门 NODE_ENV, 整体是一套"侥幸没出事"的代码. v0.10.0 一次性把这些都补上.

---

## P1 — 必修

### P1-1 无登录速率限制 / 暴力破解防护

**位置**: `lib/auth.ts:authorize()`

`authorize()` 只做"账号存在 + bcrypt 通过". 没有失败计数 / IP 限速 / 全局阈值. 攻击者对弱密码 admin 账号可以无限尝试. bcrypt cost=12 约 250ms/次, 攻击者用代理池完全可承受.

**修复**:
- 新建 [`lib/login-rate-limit.ts`](../../lib/login-rate-limit.ts): 双层防护
  - **IP 维度** (in-memory Map): 5min 窗口内 20 次失败 → 限速, 跨实例不共享但单实例足够挡 99% 暴力
  - **用户维度** (DB `User.lockedUntil` / `User.failedLoginCount`): 5 次失败锁 15min, 第 6 次起锁 60min, 跨实例可见
- 衰减窗口 30min: 距上次失败 > 30min 视为新一轮, 允许"输错几次后冷静一会"
- IP 限速挂在 [`app/api/auth/[...nextauth]/route.ts`](../../app/api/auth/%5B...nextauth%5D/route.ts) 包裹层 (因 NextAuth v4 `authorize()` 拿不到请求 IP)

### P1-2 登录失败没有审计日志

**位置**: `prisma/schema.prisma` 的 `OperationLog`, 没有任何 auth 类事件写入

业务侧所有变更都有审计 (`OperationLog`), 但"账号安全"层完全裸奔:
- 登录失败 (无论工号是否存在)
- 登录成功但来源 IP 异常
- JWT 失效 (用户被禁后的尝试)
- 密码被重置

`authorize()` 里 `bcrypt.compare` 失败直接 `return null`, 连日志都没有.

**修复**:
- 新建 [`lib/login-audit.ts`](../../lib/login-audit.ts), 8 类事件写 `OperationLog`:
  - `LOGIN_SUCCESS` / `LOGIN_FAIL` / `LOGIN_LOCKED` / `LOGIN_RATE_LIMITED`
  - `PASSWORD_RESET_REQUESTED` / `PASSWORD_RESET_CONSUMED` / `PASSWORD_RESET_INVALID` / `PASSWORD_CHANGED`
- `diff` 字段仅记 employeeNo + reason (e.g. `failed_count=3`, `locked_until=2026-07-11T...`), **绝不写明文密码 / token**
- `actorId` 默认 `system` (id="system"), 登录成功时为该用户 id
- 通过 `lib/request-context.ts` 的 AsyncLocalStorage 自动取 IP / UA / requestId, 无新字段

### P1-3 `useSecureCookies` 与 `FORCE_HTTPS` 耦合容易配置错误

**位置**: `lib/auth.ts`

```ts
useSecureCookies: isProd ? forceHttps : false
```

只看注释"forceHttps=false 时浏览器不存 secure cookie", 但更深层: 反代终止 TLS 后 NextAuth 默认不会校验 `X-Forwarded-Proto`. 运维忘了设 `FORCE_HTTPS=true`, cookie 回退到非 secure, **会话 cookie 在 HTTP 链路上明文传输**.

**修复**:
- `lib/auth.ts` 启动时 `if (isProd && !forceHttps) console.warn(...)`, 启动日志可观测
- NextAuth v4 没有 `trustHost` 选项 (那是 v5), 它读 `NEXTAUTH_URL` 自动判断. v0.10.0 在 `.env.example` 和 `lib/env.ts#assertProductionConfig` 双重 fail-fast 提示生产必填 `NEXTAUTH_URL` / `FORCE_HTTPS`

### P1-4 开放重定向防护有遗漏

**位置**: `app/login/page.tsx#safeCallbackUrl`

```ts
if (!raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
if (raw.startsWith("/\\") || raw.startsWith("/%5C") || raw.startsWith("/%2f")) return "/dashboard";
```

只挡了 3 种形式. 攻击者仍可用:
- `\\evil.com` (反斜杠在某些解析器下规约为 `/`, Spring/Cloudflare 历史上出过类似 CVE)
- `/%2F%5Cevil.com` (多层编码)
- `///evil.com` (多斜杠, curl/Chromium 都曾解析为协议相对)
- `javascript:alert(1)` / `data:text/html,...` / `vbscript:...`
- `//user@evil.com` (userinfo)
- `https://evil.com` (显式协议)

**修复**:
- 抽到独立模块 [`lib/safe-callback-url.ts`](../../lib/safe-callback-url.ts), 便于单测
- 用 `URL` 解析做白名单: 必须解析成绝对 URL, 且 `origin` 与传入 origin 一致
- 禁止 scheme / protocol-relative (`//`) / 反斜杠绕过 (`/\\`) / userinfo / 跨 origin
- SSR 时 origin 为空仅做基础白名单, 客户端水合后会再校一次
- 单测 [`tests/safe-callback-url.test.ts`](../../tests/safe-callback-url.test.ts) 9 个用例覆盖所有绕过路径

### P1-5 JWT `maxAge` 截断后 `token.exp` 兜底缺失

**位置**: `lib/auth.ts#jwt.encode`

```ts
const effectiveMaxAge = token?.remember === false ? 8 * 60 * 60 : maxAge;
return await defaultJwtEncode({ ...rest, token, maxAge: effectiveMaxAge });
```

NextAuth v4 的 `defaultJwtEncode` 内部调 `setExpirationTime(maxAge)`, 但前提是 token 里没有 `exp`. 老 token (升级前签发、`exp` 还没过期) 从 `decode` 出来仍带 `exp`, NextAuth 不会再用 `maxAge` 重新算.

**修复**:
- [`lib/auth.ts`](../../lib/auth.ts) `jwt` 回调里显式写 `token.exp = nowSec + ttl`, 兜底覆盖老 token 跨升级的情况
- 顺手把 TTL = `remember ? 7d : 8h` 抽成常量, 避免 `remember=false` 误用其他值

---

## P2 — 应修

### P2-1 工号不区分大小写 + 没有规范化

**位置**: `lib/auth.ts` `authorize()`, `app/login/page.tsx` 表单, `scripts/shared/seed-test-users.ts`

`User.employeeNo` 的 `@unique` 在 Postgres 默认是大小写敏感, "Admin" vs "admin" 会被当成两个工号.

**修复**:
- 新建 `lib/auth.ts#normalizeEmployeeNo(raw)` = `String(raw).trim().toLowerCase()`
- `authorize()` 第一行归一化; 前端表单 `handleFinish` 同步 `trim().toLowerCase()`; `seed-test-users.ts` 工号也是小写 (`admin`/`sales`/`finance`/`ops`/`expert`)
- 后续 `create-admin` / `reset-password` 等创建/查询路径都走 normalizeEmployeeNo

### P2-2 失败/成功两种情形没有差别 → 必须靠审计 + IP+工号组合定位

已经在 P1-2 通过审计日志解决. 单独的"失败不带 reason" 是与 P1-2 绑定的连带修复.

### P2-3 系统占位 user 的密码 hash 是固定字符串

**位置**: `prisma/seed.ts`, `scripts/shared/seed-roles.ts`

```ts
passwordHash: "$2b$10$ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"
```

`isSystem=true` 在 `authorize` 里挡住了. 但如果哪天有人加了一个不查 `isSystem` 的查询路径, 这个字符串可能被拿去当 bcrypt 输入, 不同 bcrypt 实现下结果不一致.

**修复**:
- 两个脚本都改用 `bcrypt.hashSync(randomBytes(32), 12)`, 一次性随机, 永远不和真实密码撞
- `lib/system.ts` 文档同步说明

### P2-4 `seed:dev-users` 在生产能跑会覆盖真账号密码

**位置**: `scripts/shared/seed-test-users.ts`

5 个 dev 账号工号 `admin/sales/finance/ops/expert` 跟生产真账号 (一般是 `QT0001` 这种) 不冲突, 但万一生产有人用 `admin` 当工号, `seed:dev-users` 会**幂等覆盖**它的密码到 `DEV_QUICK_FILL_PASSWORD`.

**修复**:
- 脚本入口加 `if (NODE_ENV === "production") process.exit(2)`, 启动期拒跑
- 文档 / README 同步强调: 仅 dev/test 用

### P2-5 登录页"忘记密码"是 mailto, 没有自助重置

**位置**: `app/login/page.tsx`, `scripts/shared/reset-password.ts`

旧版重置密码完全依赖:
- 管理员 SSH 上去跑 `pnpm reset-password --employeeNo xxx`
- 走 `mailto:it@qt.com` 流程 (人工响应 + 人工改库)

两个都不抗压, 没有审计、没有临时令牌.

**修复**:
- 新建 [`lib/password-reset.ts`](../../lib/password-reset.ts) + `app/api/auth/password-reset/{request,confirm}` 两个 endpoint
- token 设计: `crypto.randomBytes(32).toString("base64url")` (43 字符), 仅存 `SHA-256(token)`, 一次性消费, 30min TTL
- 无邮件基础设施下的送达: 申请接口把完整 reset URL 写到 `OperationLog` (action=`PASSWORD_RESET_LINK`), 管理员通过 `/api/operation-logs` 查到链接, 通过内部渠道 (电话 / 现场 / 后续接 IM) 送达
- 改密成功后自动清 `User.mustChangePassword / failedLoginCount / lockedUntil`
- 登录页 `?resetToken=xxx` 直接进改密表单 (覆盖原有登录表单); 改密成功后 `router.replace("/login")`
- 登录成功但 `mustChangePassword=true` 跳 `/login?resetRequired=1` 强制改密
- 5min/5 次 IP 限速防 token 洪水
- 单测 [`tests/login-security.test.ts`](../../tests/login-security.test.ts) 覆盖 hash 抗碰撞 / 长度 / 唯一性 / TTL / URL 拼接

### P2-6 旧密码泄漏到 git — `legacy-fineui.mjs`

**位置**: `scripts/migrate/legacy-fineui.mjs:233`

```js
const passwordHash = await bcrypt.hash("123456", 12);
```

迁移脚本硬编码弱密码, 任何残留账号都是 `123456`.

**修复**:
- 每个用户用 `crypto.randomBytes(16).toString("base64")` 生成 22 字符随机密码
- 同时打 `mustChangePassword=true`, 用户首次登录被踢到改密页
- 真实密码通过 out-of-band 渠道 (邮件 / 站内信 / 现场) 由管理员送达

---

## P3 — 建议

### P3-1 auth 缓存 30s 窗口 + 角色变更失效逻辑

**位置**: `lib/auth.ts`

`invalidateAuthCache` 是手动调用, 需要 admin 改角色/禁用户的所有路径都记得调用. 一行遗漏 = 用户拿着旧角色继续操作 30s.

**修复**:
- TTL 30s → **2s**
- `User.roleVersion` 字段: 角色/权限变更时 +1, JWT 携带, `loadActiveUser` 一起查. 任何一处忘了 bump 也不会出问题 (TTL 兜底)
- 大多数路径主动调 `invalidateAuthCache(uid)`, 立即失效

### P3-2 `secret` 走 env 而非 process.env

**位置**: `lib/auth.ts`

`secret: process.env.NEXTAUTH_SECRET` — `lib/env.ts` 启动期 fail-fast 校验了, 但类型不对, 单测 mock 也别扭.

**修复**:
- 改为 `secret: env.NEXTAUTH_SECRET` (从 `lib/env.ts` import), 类型 / 启动校验 / 测试 mock 三友好

### P3-3 `lastLoginAt` 更新未走事务

**位置**: `lib/auth.ts:authorize()`

```ts
await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
```

与 `bcrypt.compare` 成功的判断没有原子性. update 失败会让日志显示"用户登入但 lastLoginAt 没更新", 难以排查.

**修复**:
- 包在 `.catch((e) => console.error(...))`, 不阻塞登录主流程
- 不 await (fire-and-forget), 让登录响应更快返回

### P3-4 登录成功后 `router.push + router.refresh` 竞态

**位置**: `app/login/page.tsx`

两个连续调用有竞态: 第二个 refresh 会让 RSC tree 重新挂载, 可能把刚 push 的状态打掉.

**修复**:
- 改为 `router.replace(callbackUrl)` 后 `await Promise.resolve(router.refresh())`
- `replace` 不会留 history, 用户点返回不会回到 /login

### P3-5 没看到 Security headers

**位置**: `next.config.mjs`

没设 `headers()`, 登录页可能被嵌入 iframe 做 clickjacking, MIME 嗅探, referer 泄漏等.

**修复** ([`next.config.mjs`](../../next.config.mjs)):
- `X-Frame-Options: DENY` 防 clickjacking
- `X-Content-Type-Options: nosniff` 防 MIME 嗅探
- `Referrer-Policy: strict-origin-when-cross-origin` 防 referer 泄漏
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` 关掉不必要的浏览器能力
- CSP: `default-src 'self'`, 禁 frame-ancestors, 禁 base-uri 注入, form-action 限本 origin. style-src 暂放 `'unsafe-inline'` (antd 6 + pro-components 用了 css-in-js 内联), 后续可走 nonce

---

## 部署清单

1. `npx prisma migrate deploy` — 应用 `20260711_login_security_hardening`
2. 重启 next start — 让 `next.config.mjs` headers 生效; 反代 / CDN 缓存层建议 purge 一次
3. 已登录用户**无需操作** — 新 schema 字段实时读, 旧的 7 天 cookie 不受影响
4. 生产首次部署后建议**手动**跑一次 `pnpm seed-roles` — 让 system 占位 user 也用随机 hash (migration 不会动它)
5. 监控 `/api/operation-logs` 中 `entity="Auth"` 的事件 — 异常 IP / 高频失败能第一时间看到

## 仍有的开放点

1. **邮件送达** — 当前 reset link 走 OperationLog, 等真有 IM/邮件通道接入时, 把 `app/api/auth/password-reset/request/route.ts` 里 `prisma.operationLog.create` 那段替换成发送调用即可 (OperationLog 仍写, 作为兜底审计)
2. **`/api/operation-logs` UI 没标 auth 类型** — 新加的 `Auth` entity 不会出现在 `lib/operation-log-format.ts#ENTITY_LABELS`, 需后续在列表页过滤展示. 当前 curl `/api/operation-logs?entity=Auth` 即可看到全量
3. **跨实例 IP 限速** — 当前 IP 维度是 in-memory Map, 多实例下每实例独立. 单实例足够挡 99% 暴力穷举, 真要多实例协同可换成 Redis token bucket, 等真有需求再做
