# 钉钉第三方登录 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 在现有「工号+密码」登录旁新增钉钉企业内自建应用扫码登录,扫码时自动按 mobile 绑定到现有 User;复用 NextAuth JWT + loadActiveUser 缓存路径,零行为偏差。

**Architecture:** 服务端不引入 NextAuth Provider,自建 5 个 Route Handler(enabled / qrcode / poll / finish / cancel);扫码态用 DingtalkLoginCode Prisma 表存(180s TTL + 一次性消费),绑定关系存到新表 UserIdentity;User.dingtalkBoundAt 留作审计冗余;钉钉 upstream 凭证封装在 lib/dingtalk.ts 内部带内存 access_token 缓存;前端在登录页 /login 旁增加二维码面板,自动按 isDingtalkEnabled() 隐藏。

**Tech Stack:** Next.js 16 App Router, NextAuth v4 (encode 复用,无新 Provider), Prisma 7, PostgreSQL 16, zod 4, jose (沿用), node:crypto, qrcode (npm 包,前端 canvas 渲染)。

---

## File Structure

| File | Responsibility |
| --- | --- |
| prisma/schema.prisma | 加 UserIdentity 模型 + User.dingtalkBoundAt + User.identities 反向 |
| prisma/migrations/20260705_dingtalk_login/migration.sql | 新表 + 改 User.phone 为 NOT NULL UNIQUE + GRANT qt_app (v0.7.0 教训) |
| lib/env.ts | 加 DINGTALK_APP_KEY/SECRET/LOGIN_SCOPE + 导出 isDingtalkEnabled() |
| types/errors.ts | 加 9 个 DINGTALK_* 错误码 + 中文 message |
| lib/audit.ts | 把 ctorId 放宽为 string \| null(供 dingtalk_poll 失败时系统事件用) |
| lib/dingtalk.ts | upstream SDK 封装:access_token 内存缓存 + 3 个 endpoint + zod 入参校验 |
| lib/auth.ts | **不动**;inish 拿到 user.id 后走 finish 路由**自己**实现的 loadActiveUser |
| pp/api/auth/dingtalk/enabled/route.ts | GET,返回 { enabled: boolean },供登录页 SSR/CSR 探测 |
| pp/api/auth/dingtalk/qrcode/route.ts | GET,拿 access_token + 调钉钉拿二维码 URL + 写 DingtalkLoginCode |
| pp/api/auth/dingtalk/poll/route.ts | GET ?state=...,推进 PENDING→CONFIRMED→READY/CANCELLED/EXPIRED |
| pp/api/auth/dingtalk/finish/route.ts | POST { state },按 unionid / mobile 查 User,事务内建 UserIdentity + 签 JWT + set cookie |
| pp/api/auth/dingtalk/cancel/route.ts | POST { state },PENDING → EXPIRED |
| pp/login/page.tsx | 在表单后插「钉钉扫码」面板;enabled=false 时整体隐藏 |
| lib/i18n.ts | 加 12 条 login.dingtalk.* 文案 |
| server/jobs/clean-expired-dingtalk-codes.ts | cron job:每天清 status IN (PENDING, EXPIRED) AND expiresAt < now-1d,限 1000/次 |
| server/jobs/runner.ts | 注册新 job |
| .env.example | 加 3 个 DINGTALK_* 注释段 |
| docs/阿里云 ECS 单主机部署方案 — qt-biz v0.1.0.md | 加「钉钉登录配置」小节 |
| ests/unit/lib/dingtalk-env.test.ts | env + isDingtalkEnabled 3 个 case |
| ests/unit/lib/dingtalk-errors.test.ts | 9 个 DINGTALK_* 错误码 |
| ests/unit/lib/dingtalk-sdk.test.ts | lib/dingtalk.ts 6 个 case |
| ests/api/dingtalk-enabled.test.ts | enabled route 2 个 case |
| ests/api/dingtalk-qrcode.test.ts | qrcode route 3 个 case |
| ests/api/dingtalk-poll.test.ts | poll route 5 个 case |
| ests/api/dingtalk-finish.test.ts | finish route 7 个 case |
| ests/api/dingtalk-cancel.test.ts | cancel route 3 个 case |
| ests/unit/server/clean-expired-dingtalk-codes.test.ts | cron 1 个 case |
| ests/e2e/16-dingtalk-login.spec.ts | Playwright page.route mock 钉钉 upstream |

> **纠偏:** spec §11.3 写 lib/jobs/cleanExpiredDingtalkCodes.ts,但仓库内 job 一律在 server/jobs/(见 server/jobs/runner.ts),本计划统一用 server/jobs/clean-expired-dingtalk-codes.ts。

---

## Global Constraints

- **TDD 顺序**:每个新 service/route 先写失败测试,看到红再写实现。
- **复用现有**:NextAuth uthOptions、udit()、unWithRequestContext、ERROR_CODES 模式 全部不动。loadActiveUser 在 finish 路由**新**建本地副本(同形),不修改 lib/auth.ts。
- **env 能力开关**:isDingtalkEnabled() 缺 APP_KEY/SECRET 返 alse,**不**抛错;生产不 fail-fast。
- **不引入新依赖**:qrcode 加入 package.json;jose/
ext-auth 复用。
- **手机号约束**:User.phone 在迁移里强制 NOT NULL UNIQUE;不依赖 Prisma schema 改动(Schema 同步用新文件),迁移用 raw SQL,@@unique 用 CREATE UNIQUE INDEX (v0.7.0 customer.code 模式)。
- **GRANT**:user_identities / dingtalk_login_codes 表末尾必须 GRANT ALL ON TABLE ... TO qt_app; (v0.7.0 教训)。
- **事务边界**:inish 内 update DingtalkLoginCode { status: CONSUMED } **不**进 UserIdentity 事务;两段串行(Spec §4.3 第 4 步钉死)。
- **回滚路径**:不删表 / 不删列;只删 env → isDingtalkEnabled() === false → 登录页隐藏。
- **不开灰度**:isDingtalkEnabled() 是 capability 探测,**不**做 admin 手动开关(本期一次性切换)。

---


## Task 1: 写失败测试 + 实现 isDingtalkEnabled() 与 env schema

**Files:**
- Create: ests/unit/lib/dingtalk-env.test.ts
- Modify: lib/env.ts (加 3 个 zod + 导出 helper)
- Modify: .env.example (加注释段,无真值)
- Test: 
pm test -- dingtalk-env

**Interfaces:**
- 引入:env.DINGTALK_APP_KEY: string | undefined、env.DINGTALK_APP_SECRET: string | undefined、env.DINGTALK_LOGIN_SCOPE: string(默认 "snsapi_login")。
- 导出:isDingtalkEnabled(): boolean(与 isMinioEnabled() 同风格)。

- [ ] **Step 1: 写失败测试**

ests/unit/lib/dingtalk-env.test.ts:

`s
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("isDingtalkEnabled", () => {
  const original = { ...process.env };
  beforeEach(() => {
    delete process.env.DINGTALK_APP_KEY;
    delete process.env.DINGTALK_APP_SECRET;
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("APP_KEY/SECRET 都缺 → false", async () => {
    const { isDingtalkEnabled } = await import("@/lib/env");
    expect(isDingtalkEnabled()).toBe(false);
  });

  it("仅 APP_KEY 缺 SECRET → false", async () => {
    process.env.DINGTALK_APP_KEY = "key123";
    const { isDingtalkEnabled } = await import("@/lib/env");
    expect(isDingtalkEnabled()).toBe(false);
  });

  it("两者都有 → true", async () => {
    process.env.DINGTALK_APP_KEY = "key123";
    process.env.DINGTALK_APP_SECRET = "secret456";
    const { isDingtalkEnabled } = await import("@/lib/env");
    expect(isDingtalkEnabled()).toBe(true);
  });
});
`

- [ ] **Step 2: 跑测试看红**

`ash
npm test -- tests/unit/lib/dingtalk-env.test.ts
`

Expected: FAIL(isDingtalkEnabled is not a function / DINGTALK_APP_KEY is not in env)。

- [ ] **Step 3: 在 lib/env.ts 加 schema + helper**

在 createEnv 的 server 块追加(参考 MINIO_ENDPOINT 等「能力开关」写法):

`s
// 钉钉企业内自建应用扫码登录(可选;缺则登录页隐藏入口)
DINGTALK_APP_KEY: z.string().min(1).optional(),
DINGTALK_APP_SECRET: z.string().min(1).optional(),
DINGTALK_LOGIN_SCOPE: z.string().min(1).default("snsapi_login"),
`

在 untimeEnv 同步加 3 个键。

文件末尾 getPublicBaseUrl 之后追加 helper(与 isMinioEnabled() 同段):

`s
export function isDingtalkEnabled(): boolean {
  return Boolean(env.DINGTALK_APP_KEY && env.DINGTALK_APP_SECRET);
}
`

- [ ] **Step 4: .env.example 加注释段(无真值)**

在 CRON_SECRET="" 下方、MinIO 段上方插入:

`ash
# ---------- 钉钉企业内自建应用扫码登录(可选;缺则登录页隐藏钉钉入口) ----------
# 在 https://open-dev.dingtalk.com/ 创建「企业内部应用」后获取 AppKey/AppSecret;
# 安全设置 → 登录权限勾选「扫码登录」并配置回调域为本服务的 NEXTAUTH_URL。
# 本地开发可不配:登录页只显示工号+密码表单。
# DINGTALK_APP_KEY="your_app_key"
# DINGTALK_APP_SECRET="your_app_secret"
# DINGTALK_LOGIN_SCOPE="snsapi_login"
`

- [ ] **Step 5: 跑测试看绿 + 全量 typecheck**

`ash
npm test -- tests/unit/lib/dingtalk-env.test.ts
npm run typecheck
`

Expected: 3 个 case 全过;typecheck 0 错。

- [ ] **Step 6: Commit**

`ash
git add lib/env.ts .env.example tests/unit/lib/dingtalk-env.test.ts
git commit -m "feat(auth): add DINGTALK_APP_KEY/SECRET env + isDingtalkEnabled()"
`

---

## Task 2: 加 9 个 DINGTALK_* 错误码

**Files:**
- Modify: types/errors.ts
- Test: 
pm test -- dingtalk-errors

- [ ] **Step 1: 写失败测试**

ests/unit/lib/dingtalk-errors.test.ts:

`s
import { describe, it, expect } from "vitest";
import { ERROR_CODES, ERROR_MESSAGES } from "@/types/errors";

describe("DINGTALK_* error codes", () => {
  const expected = [
    "DINGTALK_NOT_CONFIGURED",
    "DINGTALK_UPSTREAM_ERROR",
    "DINGTALK_STATE_NOT_FOUND",
    "DINGTALK_QR_EXPIRED",
    "DINGTALK_STATE_NOT_READY",
    "DINGTALK_STATE_CONSUMED",
    "DINGTALK_PHONE_NOT_REGISTERED",
    "DINGTALK_PHONE_AMBIGUOUS",
    "DINGTALK_USER_DISABLED",
  ];
  for (const code of expected) {
    it(\ 已注册, () => {
      expect(ERROR_CODES[code as keyof typeof ERROR_CODES]).toBe(code);
      expect(ERROR_MESSAGES[code as keyof typeof ERROR_MESSAGES]).toBeTruthy();
    });
  }
});
`

- [ ] **Step 2: 跑测试看红**

`ash
npm test -- tests/unit/lib/dingtalk-errors.test.ts
`

Expected: FAIL(Cannot read property 'DINGTALK_NOT_CONFIGURED' of undefined)。

- [ ] **Step 3: 在 types/errors.ts 加 9 个 key + 中文 message**

在 ERROR_CODES 末尾追加:

`s
  // 钉钉登录
  DINGTALK_NOT_CONFIGURED: "DINGTALK_NOT_CONFIGURED",
  DINGTALK_UPSTREAM_ERROR: "DINGTALK_UPSTREAM_ERROR",
  DINGTALK_STATE_NOT_FOUND: "DINGTALK_STATE_NOT_FOUND",
  DINGTALK_QR_EXPIRED: "DINGTALK_QR_EXPIRED",
  DINGTALK_STATE_NOT_READY: "DINGTALK_STATE_NOT_READY",
  DINGTALK_STATE_CONSUMED: "DINGTALK_STATE_CONSUMED",
  DINGTALK_PHONE_NOT_REGISTERED: "DINGTALK_PHONE_NOT_REGISTERED",
  DINGTALK_PHONE_AMBIGUOUS: "DINGTALK_PHONE_AMBIGUOUS",
  DINGTALK_USER_DISABLED: "DINGTALK_USER_DISABLED",
`

在 ERROR_MESSAGES 末尾追加(中文与 spec §7 表对应):

`s
  DINGTALK_NOT_CONFIGURED: "钉钉登录未配置,请联系管理员",
  DINGTALK_UPSTREAM_ERROR: "钉钉服务暂不可用,请稍后重试",
  DINGTALK_STATE_NOT_FOUND: "二维码已失效,请刷新重试",
  DINGTALK_QR_EXPIRED: "二维码已过期,请刷新",
  DINGTALK_STATE_NOT_READY: "请在手机上完成确认",
  DINGTALK_STATE_CONSUMED: "该二维码已被使用",
  DINGTALK_PHONE_NOT_REGISTERED: "该钉钉账号未关联系统用户,请联系管理员",
  DINGTALK_PHONE_AMBIGUOUS: "系统检测到多个匹配用户,请联系管理员",
  DINGTALK_USER_DISABLED: "账号已被禁用,请联系管理员",
`

- [ ] **Step 4: 跑测试看绿**

`ash
npm test -- tests/unit/lib/dingtalk-errors.test.ts
npm run typecheck
`

Expected: 9 个 case 全过。

- [ ] **Step 5: Commit**

`ash
git add types/errors.ts tests/unit/lib/dingtalk-errors.test.ts
git commit -m "feat(auth): add DINGTALK_* error codes"
`

---

## Task 3: 写 prisma/migrations/20260705_dingtalk_login/migration.sql

**Files:**
- Create: prisma/migrations/20260705_dingtalk_login/migration.sql
- Modify: prisma/schema.prisma(加模型 + 改字段,仅做开发期 client 同步)
- Test: **本地**: 
pm run prisma:deploy 在 fresh DB 上跑通,再 
pm run typecheck

> **AGENTS.md 强调**: 已合并迁移文件不可改,本任务**新**建迁移,不影响历史;User.phone 在迁移里显式 NOT NULL UNIQUE (spec §12 + v0.7.0 教训)。

- [ ] **Step 1: 改 prisma/schema.prisma(供 prisma generate 用,不影响生产)**

prisma/schema.prisma 改 User 模型,加 dingtalkBoundAt + 反向 relation:

`prisma
model User {
  // ... 现有字段 ...
  dingtalkBoundAt DateTime?        @db.Timestamptz(6)
  identities      UserIdentity[]
  // ... 现有 index 不动
}
`

在 User 模型附近新增 UserIdentity 模型:

`prisma
model UserIdentity {
  id              String   @id @default(cuid())
  userId          String
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider        String   // DINGTALK | 预留 WECHAT_WORK / FEISHU
  providerUserId  String   // 钉钉 unionid
  mobileSnapshot  String?
  unionidSnapshot String?
  boundAt         DateTime @default(now()) @db.Timestamptz(6)
  boundBy         String   // SELF | ADMIN | MIGRATION

  @@unique([provider, providerUserId])
  @@index([userId])
  @@map("user_identities")
}
`

新增 DingtalkLoginCode 模型(放在 AppReleaseRead 之后):

`prisma
model DingtalkLoginCode {
  id             String    @id @default(cuid())
  state          String    @unique
  tmpCode        String
  status         String    @default("PENDING") // PENDING | CONFIRMED | READY | CONSUMED | EXPIRED | CANCELLED
  unionid        String?
  mobile         String?
  nick           String?
  employeeNoHint String?
  ip             String?
  userAgent      String?
  expiresAt      DateTime  @db.Timestamptz(6)
  consumedAt     DateTime? @db.Timestamptz(6)
  consumedById   String?
  createdAt      DateTime  @default(now()) @db.Timestamptz(6)

  @@index([status, expiresAt])
  @@index([createdAt])
  @@map("dingtalk_login_codes")
}
`

- [ ] **Step 2: 写迁移 SQL**

prisma/migrations/20260705_dingtalk_login/migration.sql:

`sql
-- 钉钉扫码登录 (spec docs/superpowers/specs/2026-07-05-dingtalk-login-design.md)
-- 1. User.dingtalkBoundAt 审计字段
-- 2. user_identities 多 Provider 绑定表
-- 3. dingtalk_login_codes 临时码表
-- 4. User.phone 强制 NOT NULL + UNIQUE (v0.7.0 教训,同 customer.code 模式)
-- 5. 末尾 GRANT 给 qt_app (BYPASSRLS 不旁路表级权限)

BEGIN;

-- 1) User 字段
ALTER TABLE "User" ADD COLUMN "dingtalkBoundAt" TIMESTAMPTZ(6);

-- 2) user_identities
CREATE TABLE "user_identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT NOT NULL,
    "mobileSnapshot" TEXT,
    "unionidSnapshot" TEXT,
    "boundAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "boundBy" TEXT NOT NULL,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_identities_provider_providerUserId_key" ON "user_identities"("provider", "providerUserId");
CREATE INDEX "user_identities_userId_idx" ON "user_identities"("userId");

ALTER TABLE "user_identities"
    ADD CONSTRAINT "user_identities_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) dingtalk_login_codes
CREATE TABLE "dingtalk_login_codes" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "tmpCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "unionid" TEXT,
    "mobile" TEXT,
    "nick" TEXT,
    "employeeNoHint" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "consumedAt" TIMESTAMPTZ(6),
    "consumedById" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dingtalk_login_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dingtalk_login_codes_state_key" ON "dingtalk_login_codes"("state");
CREATE INDEX "dingtalk_login_codes_status_expiresAt_idx" ON "dingtalk_login_codes"("status", "expiresAt");
CREATE INDEX "dingtalk_login_codes_createdAt_idx" ON "dingtalk_login_codes"("createdAt");

-- 4) User.phone 强制约束
-- 现存数据先查空手机号,期望 P0 阶段无 NULL;若有,迁移前需先 UPDATE
DO \$\$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM "User" WHERE "phone" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'User.phone 存在 % 个 NULL,迁移前请补齐 (spec 强制约束)', null_count;
  END IF;
END \$\$;

ALTER TABLE "User" ALTER COLUMN "phone" SET NOT NULL;
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

COMMIT;

-- 5) GRANT qt_app (BYPASSRLS 不旁路表级权限)
GRANT ALL ON TABLE "user_identities" TO qt_app;
GRANT ALL ON TABLE "dingtalk_login_codes" TO qt_app;
`

> 注:PostgreSQL 的 ALTER TABLE ... ALTER COLUMN ... SET NOT NULL 在外层 BEGIN/COMMIT 内;如果现存数据有 NULL,DO \$\$ ... RAISE EXCEPTION 会回滚整段,需先在 DB 端补齐手机号再重新跑迁移。

- [ ] **Step 3: 同步 prisma client + 本地 deploy**

`ash
npm run prisma:generate
npm run prisma:deploy
`

Expected: 1 migration(s) applied(或 Already up to date 若重跑)。检查 _prisma_migrations 表有 20260705_dingtalk_login 一行。

- [ ] **Step 4: typecheck + 跑现存 1 个回归测试 (确认没破坏其他表)**

`ash
npm run typecheck
npm test -- tests/api/app-release
`

Expected: typecheck 0 错;ests/api/app-release 全部通过(因为 prisma client 重新 generate,模型变化可能影响类型)。

- [ ] **Step 5: Commit**

`ash
git add prisma/schema.prisma prisma/migrations/20260705_dingtalk_login/migration.sql
git commit -m "feat(auth): dingtalk login migration (user_identities + phone UNIQUE)"
`

---

## Task 4: 实现 lib/dingtalk.ts upstream 封装

**Files:**
- Create: lib/dingtalk.ts
- Test: ests/unit/lib/dingtalk-sdk.test.ts (mock etch)

**Interfaces:**
- 导出:
  - getQrCode(): Promise<{ qrcodeUrl: string; tmpCode: string; expiresIn: number }>
  - pollQrCode(tmpCode: string): Promise<{ status: "PENDING" | "WAITING_CONFIRM" | "CANCELLED" | "CONFIRMED"; authCode?: string }>
  - getUserInfoByAuthCode(authCode: string): Promise<{ unionid: string; mobile: string; nick: string }>
- 内部:access_token 内存缓存(Map<string, { token: string; expiresAt: number }>,TTL 7000s),按 ppKey 索引。

- [ ] **Step 1: 写失败测试 (mock fetch)**

ests/unit/lib/dingtalk-sdk.test.ts:

`s
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("dingtalk sdk", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.DINGTALK_APP_KEY = "test_key";
    process.env.DINGTALK_APP_SECRET = "test_secret";
  });

  it("getQrCode 调 upstream 拿 qrcodeUrl/tmpCode/expiresIn", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok", expires_in: 7200 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tmpCode: "tc1", expiresIn: 180, qrcodeUrl: "https://oapi/qr?code=tc1" }) });

    const { getQrCode } = await import("@/lib/dingtalk");
    const r = await getQrCode();
    expect(r.qrcodeUrl).toBe("https://oapi/qr?code=tc1");
    expect(r.tmpCode).toBe("tc1");
    expect(r.expiresIn).toBe(180);
  });

  it("getQrCode upstream 失败抛 DINGTALK_UPSTREAM_ERROR 风格错误", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    const { getQrCode } = await import("@/lib/dingtalk");
    await expect(getQrCode()).rejects.toThrow(/upstream/);
  });

  it("access_token 二次调用复用缓存 (同一 process 调 2 次只 fetch 1 次 token)", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok", expires_in: 7200 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tmpCode: "tc1", expiresIn: 180, qrcodeUrl: "u" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tmpCode: "tc2", expiresIn: 180, qrcodeUrl: "u" }) });
    const { getQrCode } = await import("@/lib/dingtalk");
    await getQrCode();
    await getQrCode();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const tokenCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("gettoken"));
    expect(tokenCalls.length).toBe(1);
  });

  it("pollQrCode 未确认 → PENDING", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "PENDING" }) });
    const { pollQrCode } = await import("@/lib/dingtalk");
    const r = await pollQrCode("tc1");
    expect(r.status).toBe("PENDING");
  });

  it("pollQrCode 已确认 → CONFIRMED + authCode", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "CONFIRMED", authCode: "ac1" }) });
    const { pollQrCode } = await import("@/lib/dingtalk");
    const r = await pollQrCode("tc1");
    expect(r.status).toBe("CONFIRMED");
    expect(r.authCode).toBe("ac1");
  });

  it("getUserInfoByAuthCode 拿 unionid/mobile/nick", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { userid: "u_abc" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { mobile: "13800000000", nick: "张三", unionid: "uid_xyz" } }) });
    const { getUserInfoByAuthCode } = await import("@/lib/dingtalk");
    const r = await getUserInfoByAuthCode("ac1");
    expect(r.mobile).toBe("13800000000");
    expect(r.nick).toBe("张三");
    expect(r.unionid).toBe("uid_xyz");
  });
});
`

- [ ] **Step 2: 跑测试看红**

`ash
npm test -- tests/unit/lib/dingtalk-sdk.test.ts
`

Expected: FAIL(Cannot find module '@/lib/dingtalk')。

- [ ] **Step 3: 实现 lib/dingtalk.ts**

`s
// 钉钉企业内部应用 - 扫码登录 upstream 封装
// 设计要点:
//   - access_token 内存缓存,TTL 7000s(钉钉 7200s 留 200s 缓冲),按 appKey 索引
//   - 不引入新 SDK,直接 fetch 钉钉 OpenAPI
//   - endpoint 常量集中在本文件,后续钉钉文档变更只动这里
import { env } from "./env";
import { ApiError } from "./api";
import { ERROR_CODES } from "@/types/errors";

const TOKEN_TTL_MS = 7000 * 1000;
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

const ENDPOINT_GET_TOKEN = "https://oapi.dingtalk.com/gettoken";
const ENDPOINT_QRCODE = "https://oapi.dingtalk.com/connect/oauth2/sns_authorize";
const ENDPOINT_POLL = "https://oapi.dingtalk.com/connect/oauth2/sns_token";
const ENDPOINT_USER_INFO_BY_CODE = "https://oapi.dingtalk.com/topapi/v2/user/getuserinfo";
const ENDPOINT_USER_GET = "https://oapi.dingtalk.com/topapi/v2/user/get";

function requireCreds() {
  if (!env.DINGTALK_APP_KEY || !env.DINGTALK_APP_SECRET) {
    throw new ApiError(ERROR_CODES.DINGTALK_NOT_CONFIGURED, "钉钉未配置", 503);
  }
  return { appKey: env.DINGTALK_APP_KEY, appSecret: env.DINGTALK_APP_SECRET };
}

async function getAccessToken(): Promise<string> {
  const { appKey, appSecret } = requireCreds();
  const cached = tokenCache.get(appKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const url = \$ {ENDPOINT_GET_TOKEN}?appkey=\&appsecret=\;
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, gettoken HTTP \, 502);
  const json = (await res.json()) as { access_token?: string; errcode?: number; errmsg?: string };
  if (!json.access_token) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, gettoken: \, 502);
  tokenCache.set(appKey, { token: json.access_token, expiresAt: Date.now() + TOKEN_TTL_MS });
  return json.access_token;
}

export type QrCodeResult = { qrcodeUrl: string; tmpCode: string; expiresIn: number };

export async function getQrCode(): Promise<QrCodeResult> {
  const { appKey } = requireCreds();
  const accessToken = await getAccessToken();
  const url = \$ {ENDPOINT_QRCODE}?access_token=\&appid=\&response_type=code&scope=snsapi_login&state=;
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, qrcode HTTP \, 502);
  const json = (await res.json()) as { tmpCode?: string; expiresIn?: number; qrcodeUrl?: string; errmsg?: string };
  if (!json.tmpCode) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, qrcode: \, 502);
  return {
    qrcodeUrl: json.qrcodeUrl ?? url + (json.tmpCode ?? ""),
    tmpCode: json.tmpCode,
    expiresIn: json.expiresIn ?? 180,
  };
}

export type PollResult =
  | { status: "PENDING" }
  | { status: "WAITING_CONFIRM" }
  | { status: "CANCELLED" }
  | { status: "CONFIRMED"; authCode: string };

export async function pollQrCode(tmpCode: string): Promise<PollResult> {
  const accessToken = await getAccessToken();
  const url = \$ {ENDPOINT_POLL}?access_token=\&tmpCode=\;
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, poll HTTP \, 502);
  const json = (await res.json()) as { status?: string; authCode?: string; errmsg?: string };
  switch (json.status) {
    case "PENDING":
      return { status: "PENDING" };
    case "WAITING_CONFIRM":
      return { status: "WAITING_CONFIRM" };
    case "CANCELLED":
      return { status: "CANCELLED" };
    case "CONFIRMED":
      if (!json.authCode) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, "poll: missing authCode", 502);
      return { status: "CONFIRMED", authCode: json.authCode };
    default:
      throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, poll: \, 502);
  }
}

export type UserInfo = { unionid: string; mobile: string; nick: string };

export async function getUserInfoByAuthCode(authCode: string): Promise<UserInfo> {
  const accessToken = await getAccessToken();
  const r1 = await fetch(\$ {ENDPOINT_USER_INFO_BY_CODE}?access_token=\&code=\);
  if (!r1.ok) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, userinfo HTTP \, 502);
  const j1 = (await r1.json()) as { result?: { userid?: string }; errmsg?: string };
  const userid = j1.result?.userid;
  if (!userid) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, userinfo: \, 502);

  const r2 = await fetch(\$ {ENDPOINT_USER_GET}?access_token=\&userid=\);
  if (!r2.ok) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, user.get HTTP \, 502);
  const j2 = (await r2.json()) as { result?: { mobile?: string; nick?: string }; errmsg?: string };
  const mobile = j2.result?.mobile;
  if (!mobile) throw new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, user.get: \, 502);
  return { unionid: userid, mobile, nick: j2.result?.nick ?? "" };
}
`

- [ ] **Step 4: 跑测试看绿 + typecheck**

`ash
npm test -- tests/unit/lib/dingtalk-sdk.test.ts
npm run typecheck
`

Expected: 6 个 case 全过;typecheck 0 错。

- [ ] **Step 5: Commit**

`ash
git add lib/dingtalk.ts tests/unit/lib/dingtalk-sdk.test.ts
git commit -m "feat(auth): add lib/dingtalk.ts upstream sdk wrapper"
`

---

## Task 5: /api/auth/dingtalk/enabled 探测接口

**Files:**
- Create: pp/api/auth/dingtalk/enabled/route.ts
- Test: ests/api/dingtalk-enabled.test.ts

- [ ] **Step 1: 写失败测试**

ests/api/dingtalk-enabled.test.ts:

`s
import { describe, it, expect, vi, beforeEach } from "vitest";

describe("GET /api/auth/dingtalk/enabled", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DINGTALK_APP_KEY;
    delete process.env.DINGTALK_APP_SECRET;
  });

  it("env 缺 → enabled=false", async () => {
    const { GET } = await import("@/app/api/auth/dingtalk/enabled/route");
    const res = await GET();
    const body = await res.json();
    expect(body.data.enabled).toBe(false);
  });

  it("env 齐 → enabled=true", async () => {
    process.env.DINGTALK_APP_KEY = "k";
    process.env.DINGTALK_APP_SECRET = "s";
    const { GET } = await import("@/app/api/auth/dingtalk/enabled/route");
    const res = await GET();
    const body = await res.json();
    expect(body.data.enabled).toBe(true);
  });
});
`

- [ ] **Step 2: 跑测试看红**

`ash
npm test -- tests/api/dingtalk-enabled.test.ts
`

Expected: FAIL(Cannot find module '@/app/api/auth/dingtalk/enabled/route')。

- [ ] **Step 3: 实现 route**

pp/api/auth/dingtalk/enabled/route.ts:

`s
import { ok } from "@/lib/api";
import { isDingtalkEnabled } from "@/lib/env";

export async function GET() {
  return ok({ enabled: isDingtalkEnabled() });
}
`

- [ ] **Step 4: 跑测试看绿**

`ash
npm test -- tests/api/dingtalk-enabled.test.ts
npm run typecheck
`

Expected: 2 个 case 全过。

- [ ] **Step 5: Commit**

`ash
git add app/api/auth/dingtalk/enabled/route.ts tests/api/dingtalk-enabled.test.ts
git commit -m "feat(auth): /api/auth/dingtalk/enabled capability endpoint"
`

---

## Task 6: /api/auth/dingtalk/qrcode 生成二维码

**Files:**
- Create: pp/api/auth/dingtalk/qrcode/route.ts
- Test: ests/api/dingtalk-qrcode.test.ts

- [ ] **Step 1: 写失败测试**

ests/api/dingtalk-qrcode.test.ts:

`s
import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("GET /api/auth/dingtalk/qrcode", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    process.env.DINGTALK_APP_KEY = "k";
    process.env.DINGTALK_APP_SECRET = "s";
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://x:x@localhost:5432/x";
  });

  it("env 缺 → 503 DINGTALK_NOT_CONFIGURED", async () => {
    delete process.env.DINGTALK_APP_KEY;
    const { GET } = await import("@/app/api/auth/dingtalk/qrcode/route");
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.errorCode).toBe("DINGTALK_NOT_CONFIGURED");
  });

  it("upstream 成功 → 写库 + 返回 qrcodeUrl/state/expiresIn", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok", expires_in: 7200 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tmpCode: "tc1", expiresIn: 180, qrcodeUrl: "https://oapi/qr?tc1" }) });

    const { GET } = await import("@/app/api/auth/dingtalk/qrcode/route");
    const { prisma } = await import("@/lib/prisma");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.qrcodeUrl).toBe("https://oapi/qr?tc1");
    expect(body.data.state).toMatch(/^[A-Za-z0-9_-]{40,}\$/);
    expect(body.data.expiresIn).toBe(180);
    expect(body.data.pollIntervalMs).toBe(1500);

    const row = await prisma.dingtalkLoginCode.findUnique({ where: { state: body.data.state } });
    expect(row).toBeTruthy();
    expect(row!.status).toBe("PENDING");
    expect(row!.tmpCode).toBe("tc1");
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    await prisma.dingtalkLoginCode.delete({ where: { id: row!.id } });
  });

  it("upstream 失败 → 502 DINGTALK_UPSTREAM_ERROR", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    const { GET } = await import("@/app/api/auth/dingtalk/qrcode/route");
    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.errorCode).toBe("DINGTALK_UPSTREAM_ERROR");
  });
});
`

- [ ] **Step 2: 跑测试看红**

`ash
npm test -- tests/api/dingtalk-qrcode.test.ts
`

Expected: FAIL(Cannot find module '@/app/api/auth/dingtalk/qrcode/route')。

- [ ] **Step 3: 实现 route**

pp/api/auth/dingtalk/qrcode/route.ts:

`s
import { randomBytes } from "node:crypto";
import { ok, err } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { isDingtalkEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getQrCode } from "@/lib/dingtalk";

const QR_TTL_SECONDS = 180;
const POLL_INTERVAL_MS = 1500;

export async function GET() {
  if (!isDingtalkEnabled()) {
    return err(new ApiError(ERROR_CODES.DINGTALK_NOT_CONFIGURED, undefined, 503));
  }
  try {
    const upstream = await getQrCode();
    const state = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + QR_TTL_SECONDS * 1000);
    await prisma.dingtalkLoginCode.create({
      data: {
        state,
        tmpCode: upstream.tmpCode,
        status: "PENDING",
        expiresAt,
      },
    });
    return ok({
      qrcodeUrl: upstream.qrcodeUrl,
      state,
      expiresIn: upstream.expiresIn,
      pollIntervalMs: POLL_INTERVAL_MS,
    });
  } catch (e) {
    if (e instanceof ApiError) return err(e);
    console.error("[dingtalk/qrcode] unexpected", e);
    return err(new ApiError(ERROR_CODES.DINGTALK_UPSTREAM_ERROR, undefined, 502));
  }
}
`

- [ ] **Step 4: 跑测试看绿**

`ash
npm test -- tests/api/dingtalk-qrcode.test.ts
npm run typecheck
`

Expected: 3 个 case 全过。DB 不可达时按现有测试模式 skip(见 ests/api/app-release.test.ts 的 dbReachable 模式;本任务的 "upstream 成功 → 写库" case 没有 PG 时自动 skip)。

- [ ] **Step 5: Commit**

`ash
git add app/api/auth/dingtalk/qrcode/route.ts tests/api/dingtalk-qrcode.test.ts
git commit -m "feat(auth): /api/auth/dingtalk/qrcode endpoint"
`

---

## Task 7: /api/auth/dingtalk/poll 状态推进

**Files:**
- Create: pp/api/auth/dingtalk/poll/route.ts
- Test: ests/api/dingtalk-poll.test.ts

> **前置 patch**:lib/audit.ts 当前 ctorId: string 必填;dingtalk_poll 失败是系统事件,需把 AuditInput.actorId 改为 string | null,DB 字段已是 nullable。

- [ ] **Step 0: 先 patch lib/audit.ts**

lib/audit.ts 的 AuditInput 类型:

`s
type AuditInput = {
  actorId: string | null;  // 改:原为 string
  // ... 其余字段不动
};
`

udit() 函数内 data.actorId: input.actorId ?? null, 保持不变(已经是 string | null 入 DB)。

- [ ] **Step 1: 写失败测试**

ests/api/dingtalk-poll.test.ts:

`s
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

let dbReachable = false;
const cleanupIds: string[] = [];

describe("GET /api/auth/dingtalk/poll", () => {
  beforeEach(async () => {
    vi.resetModules();
    fetchMock.mockReset();
    process.env.DINGTALK_APP_KEY = "k";
    process.env.DINGTALK_APP_SECRET = "s";
    const { prisma } = await import("@/lib/prisma");
    try {
      await prisma.\SELECT 1;
      dbReachable = true;
    } catch {
      dbReachable = false;
    }
  });

  afterAll(async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    if (cleanupIds.length > 0) {
      await prisma.dingtalkLoginCode.deleteMany({ where: { id: { in: cleanupIds } } });
    }
    await prisma.\();
  });

  it("state 不存在 → 404 DINGTALK_STATE_NOT_FOUND", async () => {
    const { GET } = await import("@/app/api/auth/dingtalk/poll/route");
    const res = await GET(new Request("http://x/api/auth/dingtalk/poll?state=does-not-exist"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.errorCode).toBe("DINGTALK_STATE_NOT_FOUND");
  });

  it("PENDING + upstream 未确认 → 200 PENDING", async () => {
    if (!dbReachable) return;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "PENDING" }) });
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.dingtalkLoginCode.create({
      data: { state: "test-pending-1", tmpCode: "tc", expiresAt: new Date(Date.now() + 60_000) },
    });
    cleanupIds.push(row.id);
    const { GET } = await import("@/app/api/auth/dingtalk/poll/route");
    const res = await GET(new Request("http://x/api/auth/dingtalk/poll?state=test-pending-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("PENDING");
  });

  it("已过期 → 200 EXPIRED", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.dingtalkLoginCode.create({
      data: { state: "test-expired-1", tmpCode: "tc", expiresAt: new Date(Date.now() - 1000) },
    });
    cleanupIds.push(row.id);
    const { GET } = await import("@/app/api/auth/dingtalk/poll/route");
    const res = await GET(new Request("http://x/api/auth/dingtalk/poll?state=test-expired-1"));
    const body = await res.json();
    expect(body.data.status).toBe("EXPIRED");
  });

  it("CONFIRMED → 写库 unionid/mobile, status=READY", async () => {
    if (!dbReachable) return;
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: "CONFIRMED", authCode: "ac1" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { userid: "uid_abc" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ result: { mobile: "13800000000", nick: "张三" } }) });
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.dingtalkLoginCode.create({
      data: { state: "test-confirmed-1", tmpCode: "tc2", expiresAt: new Date(Date.now() + 60_000) },
    });
    cleanupIds.push(row.id);
    const { GET } = await import("@/app/api/auth/dingtalk/poll/route");
    const res = await GET(new Request("http://x/api/auth/dingtalk/poll?state=test-confirmed-1"));
    const body = await res.json();
    expect(body.data.status).toBe("READY");
    const updated = await prisma.dingtalkLoginCode.findUnique({ where: { id: row.id } });
    expect(updated!.status).toBe("READY");
    expect(updated!.unionid).toBe("uid_abc");
    expect(updated!.mobile).toBe("13800000000");
  });

  it("CANCELLED → 200 CANCELLED", async () => {
    if (!dbReachable) return;
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: "CANCELLED" }) });
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.dingtalkLoginCode.create({
      data: { state: "test-cancelled-1", tmpCode: "tc3", expiresAt: new Date(Date.now() + 60_000) },
    });
    cleanupIds.push(row.id);
    const { GET } = await import("@/app/api/auth/dingtalk/poll/route");
    const res = await GET(new Request("http://x/api/auth/dingtalk/poll?state=test-cancelled-1"));
    const body = await res.json();
    expect(body.data.status).toBe("CANCELLED");
  });
});
`

- [ ] **Step 2: 跑测试看红**

`ash
npm test -- tests/api/dingtalk-poll.test.ts
`

Expected: FAIL(Cannot find module '@/app/api/auth/dingtalk/poll/route')。

- [ ] **Step 3: 实现 route**

pp/api/auth/dingtalk/poll/route.ts:

`s
import { ok, err } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { prisma } from "@/lib/prisma";
import { runWithRequestContext } from "@/lib/request-context";
import { audit } from "@/lib/audit";
import { pollQrCode, getUserInfoByAuthCode } from "@/lib/dingtalk";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    const url = new URL(req.url);
    const state = url.searchParams.get("state");
    if (!state) return err(new ApiError(ERROR_CODES.DINGTALK_STATE_NOT_FOUND, undefined, 404));

    const row = await prisma.dingtalkLoginCode.findUnique({ where: { state } });
    if (!row) return err(new ApiError(ERROR_CODES.DINGTALK_STATE_NOT_FOUND, undefined, 404));
    if (Date.now() > row.expiresAt.getTime()) {
      return ok({ status: "EXPIRED" });
    }
    if (row.status === "READY" || row.status === "CONSUMED") {
      return ok({ status: row.status });
    }
    if (row.status !== "PENDING") {
      return ok({ status: row.status });
    }

    try {
      const poll = await pollQrCode(row.tmpCode);
      if (poll.status === "PENDING" || poll.status === "WAITING_CONFIRM") {
        return ok({ status: "PENDING" });
      }
      if (poll.status === "CANCELLED") {
        await prisma.dingtalkLoginCode.updateMany({
          where: { id: row.id, status: "PENDING" },
          data: { status: "CANCELLED" },
        });
        return ok({ status: "CANCELLED" });
      }
      const info = await getUserInfoByAuthCode(poll.authCode);
      await prisma.dingtalkLoginCode.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: { status: "READY", unionid: info.unionid, mobile: info.mobile, nick: info.nick },
      });
      return ok({ status: "READY" });
    } catch (e) {
      // upstream 失败:不报错,返 PENDING 让前端继续轮询;记审计
      await prisma.\(async (tx) => {
        await audit(tx, {
          actorId: null,
          action: "dingtalk_poll",
          entity: "DingtalkLoginCode",
          entityId: row.id,
          status: "FAILURE",
          errorMessage: e instanceof Error ? e.message : String(e),
        });
      });
      return ok({ status: "PENDING" });
    }
  });
}
`

- [ ] **Step 4: 跑测试看绿**

`ash
npm test -- tests/api/dingtalk-poll.test.ts
npm run typecheck
`

Expected: 5 个 case 全过(DB skip 模式由 dbReachable 守卫)。

- [ ] **Step 5: Commit**

`ash
git add lib/audit.ts app/api/auth/dingtalk/poll/route.ts tests/api/dingtalk-poll.test.ts
git commit -m "feat(auth): /api/auth/dingtalk/poll state machine"
`

---

## Task 8: /api/auth/dingtalk/finish 颁发 JWT

**Files:**
- Create: pp/api/auth/dingtalk/finish/route.ts
- Test: ests/api/dingtalk-finish.test.ts

**实现要点(spec §4.3 钉死):**
- 入口:校验 state 状态 = READY,否则 4xx 区分错误码。
- 消费:乐观锁 updateMany where { state, status: READY } → { status: CONSUMED, consumedAt, consumedById },并发赢家继续,输家 409。
- 查 UserIdentity(by provider=DINGTALK, providerUserId=unionid):
  - 命中 → 取 userId,走「签发 JWT」分支。
  - 未命中 → 用 mobile 查 User.phone:
    - 0 个 → 401 DINGTALK_PHONE_NOT_REGISTERED,**不**消耗 READY。
    - 1 个 → 事务内 create UserIdentity + User.update { dingtalkBoundAt: now },再走「签发 JWT」。
    - ≥2 个 → 401 DINGTALK_PHONE_AMBIGUOUS。
- 拿到 user.id 后:
  - 调本地 loadActiveUser(uid),
ull (被禁用) → 401 DINGTALK_USER_DISABLED,**仍**置 CONSUMED(spec §9 风险缓解)。
  - 否则 udit({ actorId: user.id, action: 'dingtalk_login', entity: 'User', entityId: user.id }),首次绑定再写 ction='dingtalk_bind'。
- 签发 JWT:用 
ext-auth/jwt 的 encode({ token: { uid, employeeNo, roleCode, remember: true }, secret, maxAge: 7d })。
- set cookie:
ext-auth.session-token / __Secure-next-auth.session-token(NextAuth 自动选),httpOnly, sameSite=lax, path=/, 7d。**完全复用** NextAuth 现有 cookie 行为,避免双 cookie 体系。

- [ ] **Step 1: 写失败测试**

ests/api/dingtalk-finish.test.ts:

`s
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

let dbReachable = false;
const cleanupIdentityIds: string[] = [];
const cleanupCodeIds: string[] = [];
const cleanupUserTouched: string[] = [];

describe("POST /api/auth/dingtalk/finish", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { prisma } = await import("@/lib/prisma");
    try {
      await prisma.\SELECT 1;
      dbReachable = true;
    } catch {
      dbReachable = false;
    }
  });

  afterAll(async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    if (cleanupIdentityIds.length > 0) {
      await prisma.userIdentity.deleteMany({ where: { id: { in: cleanupIdentityIds } } });
    }
    if (cleanupCodeIds.length > 0) {
      await prisma.dingtalkLoginCode.deleteMany({ where: { id: { in: cleanupCodeIds } } });
    }
    if (cleanupUserTouched.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: cleanupUserTouched } },
        data: { dingtalkBoundAt: null },
      });
    }
    await prisma.\();
  });

  it("state 不存在 → 404", async () => {
    if (!dbReachable) return;
    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/finish", {
      method: "POST", body: JSON.stringify({ state: "missing" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(404);
  });

  it("state 仍 PENDING → 409 DINGTALK_STATE_NOT_READY", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.dingtalkLoginCode.create({
      data: { state: "test-finish-pending", tmpCode: "tc", expiresAt: new Date(Date.now() + 60_000) },
    });
    cleanupCodeIds.push(row.id);
    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/finish", {
      method: "POST", body: JSON.stringify({ state: "test-finish-pending" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.errorCode).toBe("DINGTALK_STATE_NOT_READY");
  });

  it("unionid 已绑 + READY → 签 cookie + 200", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const u = await prisma.user.findFirst({ where: { deletedAt: null, status: "ACTIVE", isSystem: false } });
    if (!u) return;
    const ident = await prisma.userIdentity.create({
      data: { userId: u.id, provider: "DINGTALK", providerUserId: "test-unionid-1", boundBy: "TEST" },
    });
    cleanupIdentityIds.push(ident.id);
    const code = await prisma.dingtalkLoginCode.create({
      data: {
        state: "test-finish-bound", tmpCode: "tc", status: "READY",
        unionid: "test-unionid-1", mobile: u.phone ?? "13800000000",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    cleanupCodeIds.push(code.id);
    cleanupUserTouched.push(u.id);

    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/finish", {
      method: "POST", body: JSON.stringify({ state: "test-finish-bound" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/next-auth\.session-token/);
    const after = await prisma.dingtalkLoginCode.findUnique({ where: { id: code.id } });
    expect(after!.status).toBe("CONSUMED");
    expect(after!.consumedById).toBe(u.id);
  });

  it("unionid 未绑 + mobile 命中 1 个 → 建 UserIdentity + dingtalkBoundAt + 签 cookie", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const u = await prisma.user.findFirst({ where: { deletedAt: null, status: "ACTIVE", isSystem: false, phone: { not: null } } });
    if (!u || !u.phone) return;
    cleanupUserTouched.push(u.id);
    const code = await prisma.dingtalkLoginCode.create({
      data: {
        state: "test-finish-new-bind", tmpCode: "tc", status: "READY",
        unionid: "test-unionid-new-1", mobile: u.phone,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    cleanupCodeIds.push(code.id);
    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/finish", {
      method: "POST", body: JSON.stringify({ state: "test-finish-new-bind" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
    const ident = await prisma.userIdentity.findUnique({
      where: { provider_providerUserId: { provider: "DINGTALK", providerUserId: "test-unionid-new-1" } },
    });
    expect(ident).toBeTruthy();
    expect(ident!.userId).toBe(u.id);
    cleanupIdentityIds.push(ident!.id);
    const updated = await prisma.user.findUnique({ where: { id: u.id } });
    expect(updated!.dingtalkBoundAt).toBeTruthy();
  });

  it("unionid 未绑 + mobile 0 个 → 401 DINGTALK_PHONE_NOT_REGISTERED 且不消耗", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const code = await prisma.dingtalkLoginCode.create({
      data: {
        state: "test-finish-unregistered", tmpCode: "tc", status: "READY",
        unionid: "test-unionid-orphan", mobile: "19999999999",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    cleanupCodeIds.push(code.id);
    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/finish", {
      method: "POST", body: JSON.stringify({ state: "test-finish-unregistered" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.errorCode).toBe("DINGTALK_PHONE_NOT_REGISTERED");
    const after = await prisma.dingtalkLoginCode.findUnique({ where: { id: code.id } });
    expect(after!.status).toBe("READY");
  });

  it("user 被禁用 → 401 DINGTALK_USER_DISABLED 且 CONSUMED", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const role = await prisma.role.findFirst({ where: { code: "ADMIN" } });
    if (!role) return;
    const u = await prisma.user.create({
      data: {
        employeeNo: "test-dingtalk-disabled", name: "x",
        email: "x-dingtalk-disabled@test.local",
        passwordHash: "\\\",
        roleId: role.id, status: "DISABLED", phone: "13800008888",
      },
    });
    cleanupUserTouched.push(u.id);
    const ident = await prisma.userIdentity.create({
      data: { userId: u.id, provider: "DINGTALK", providerUserId: "test-unionid-disabled", boundBy: "TEST" },
    });
    cleanupIdentityIds.push(ident.id);
    const code = await prisma.dingtalkLoginCode.create({
      data: {
        state: "test-finish-disabled", tmpCode: "tc", status: "READY",
        unionid: "test-unionid-disabled", mobile: u.phone,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    cleanupCodeIds.push(code.id);
    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/finish", {
      method: "POST", body: JSON.stringify({ state: "test-finish-disabled" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.errorCode).toBe("DINGTALK_USER_DISABLED");
    const after = await prisma.dingtalkLoginCode.findUnique({ where: { id: code.id } });
    expect(after!.status).toBe("CONSUMED");
  });

  it("并发 finish 同一 state → 1 成功 1 返 409", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const u = await prisma.user.findFirst({ where: { deletedAt: null, status: "ACTIVE", isSystem: false } });
    if (!u) return;
    cleanupUserTouched.push(u.id);
    const ident = await prisma.userIdentity.create({
      data: { userId: u.id, provider: "DINGTALK", providerUserId: "test-unionid-race", boundBy: "TEST" },
    });
    cleanupIdentityIds.push(ident.id);
    const code = await prisma.dingtalkLoginCode.create({
      data: {
        state: "test-finish-race", tmpCode: "tc", status: "READY",
        unionid: "test-unionid-race", mobile: u.phone ?? "13800000000",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    cleanupCodeIds.push(code.id);
    const { POST } = await import("@/app/api/auth/dingtalk/finish/route");
    const [r1, r2] = await Promise.all([
      POST(new Request("http://x/api/auth/dingtalk/finish", { method: "POST", body: JSON.stringify({ state: "test-finish-race" }), headers: { "content-type": "application/json" } })),
      POST(new Request("http://x/api/auth/dingtalk/finish", { method: "POST", body: JSON.stringify({ state: "test-finish-race" }), headers: { "content-type": "application/json" } })),
    ]);
    const codes = [r1.status, r2.status].sort();
    expect(codes).toEqual([200, 409]);
  });
});
`

- [ ] **Step 2: 跑测试看红**

`ash
npm test -- tests/api/dingtalk-finish.test.ts
`

Expected: FAIL(Cannot find module '@/app/api/auth/dingtalk/finish/route')。

- [ ] **Step 3: 实现 route**

pp/api/auth/dingtalk/finish/route.ts:

`s
import { encode } from "next-auth/jwt";
import { ok, err } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { runWithRequestContext } from "@/lib/request-context";
import { audit } from "@/lib/audit";

const COOKIE_NAME_DEV = "next-auth.session-token";
const COOKIE_NAME_PROD = "__Secure-next-auth.session-token";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

async function loadActiveUser(uid: string) {
  return prisma.user.findFirst({
    where: { id: uid, deletedAt: null, status: "ACTIVE", isSystem: false },
    select: { id: true, employeeNo: true, name: true, role: { select: { code: true } } },
  });
}

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    const body = (await req.json()) as { state?: string };
    const state = body.state;
    if (!state) return err(new ApiError(ERROR_CODES.DINGTALK_STATE_NOT_FOUND, undefined, 404));

    const row = await prisma.dingtalkLoginCode.findUnique({ where: { state } });
    if (!row) return err(new ApiError(ERROR_CODES.DINGTALK_STATE_NOT_FOUND, undefined, 404));
    if (Date.now() > row.expiresAt.getTime()) {
      return err(new ApiError(ERROR_CODES.DINGTALK_QR_EXPIRED, undefined, 410));
    }
    if (row.status === "CONSUMED") {
      return err(new ApiError(ERROR_CODES.DINGTALK_STATE_CONSUMED, undefined, 409));
    }
    if (row.status !== "READY") {
      return err(new ApiError(ERROR_CODES.DINGTALK_STATE_NOT_READY, undefined, 409));
    }
    if (!row.unionid || !row.mobile) {
      return err(new ApiError(ERROR_CODES.DINGTALK_STATE_NOT_READY, undefined, 409));
    }

    // 1) 解析目标 user
    let userId: string | null = null;
    let isNewBind = false;
    const existing = await prisma.userIdentity.findUnique({
      where: { provider_providerUserId: { provider: "DINGTALK", providerUserId: row.unionid } },
    });
    if (existing) {
      userId = existing.userId;
    } else {
      const matches = await prisma.user.findMany({
        where: { phone: row.mobile, deletedAt: null },
        select: { id: true },
      });
      if (matches.length === 0) {
        return err(new ApiError(ERROR_CODES.DINGTALK_PHONE_NOT_REGISTERED, undefined, 401));
      }
      if (matches.length > 1) {
        return err(new ApiError(ERROR_CODES.DINGTALK_PHONE_AMBIGUOUS, undefined, 401));
      }
      userId = matches[0]!.id;
      isNewBind = true;
      try {
        await prisma.\(async (tx) => {
          await tx.userIdentity.create({
            data: {
              userId: userId!,
              provider: "DINGTALK",
              providerUserId: row.unionid!,
              mobileSnapshot: row.mobile,
              unionidSnapshot: row.unionid,
              boundBy: "SELF",
            },
          });
          await tx.user.update({ where: { id: userId! }, data: { dingtalkBoundAt: new Date() } });
        });
      } catch (e) {
        // 唯一冲突:并发时另一线程已建好,改用已存在
        const race = await prisma.userIdentity.findUnique({
          where: { provider_providerUserId: { provider: "DINGTALK", providerUserId: row.unionid } },
        });
        if (!race) throw e;
        userId = race.userId;
        isNewBind = false;
      }
    }

    // 3) 校验 user 仍 ACTIVE
    const user = await loadActiveUser(userId);
    if (!user) {
      await prisma.dingtalkLoginCode.updateMany({
        where: { state, status: "READY" },
        data: { status: "CONSUMED", consumedAt: new Date(), consumedById: userId },
      });
      return err(new ApiError(ERROR_CODES.DINGTALK_USER_DISABLED, undefined, 401));
    }

    // 4) 乐观锁消耗 code
    const consume = await prisma.dingtalkLoginCode.updateMany({
      where: { state, status: "READY" },
      data: { status: "CONSUMED", consumedAt: new Date(), consumedById: user.id },
    });
    if (consume.count === 0) {
      return err(new ApiError(ERROR_CODES.DINGTALK_STATE_CONSUMED, undefined, 409));
    }

    // 5) 写审计
    await prisma.\(async (tx) => {
      await audit(tx, {
        actorId: user.id,
        action: "dingtalk_login",
        entity: "User",
        entityId: user.id,
      });
      if (isNewBind) {
        await audit(tx, {
          actorId: user.id,
          action: "dingtalk_bind",
          entity: "User",
          entityId: user.id,
        });
      }
    });

    // 6) 签发 JWT (与 CredentialsProvider 同源)
    const token = await encode({
      token: {
        uid: user.id,
        employeeNo: user.employeeNo,
        roleCode: user.role.code,
        iat: Math.floor(Date.now() / 1000),
        remember: true,
      },
      secret: env.NEXTAUTH_SECRET,
      maxAge: SESSION_MAX_AGE,
    });

    // 7) set cookie
    const isProd = process.env.NODE_ENV === "production";
    const cookieName = isProd ? COOKIE_NAME_PROD : COOKIE_NAME_DEV;
    const secure = isProd;
    const cookie = \$ {cookieName}=\; HttpOnly; Path=/; Max-Age=\; SameSite=Lax\$ {secure ? "; Secure" : ""};

    const res = ok({ ok: true, redirectTo: "/dashboard" });
    res.headers.append("Set-Cookie", cookie);
    return res;
  });
}
`

- [ ] **Step 4: 跑测试看绿**

`ash
npm test -- tests/api/dingtalk-finish.test.ts
npm run typecheck
`

Expected: 7 个 case 全过;loadActiveUser 是本路由**新**的本地函数,与 lib/auth.ts 内的同名函数**不冲突**(本路由不导出,只是同形)。

- [ ] **Step 5: Commit**

`ash
git add app/api/auth/dingtalk/finish/route.ts tests/api/dingtalk-finish.test.ts
git commit -m "feat(auth): /api/auth/dingtalk/finish issue jwt + set session cookie"
`

---

## Task 9: /api/auth/dingtalk/cancel 主动取消

**Files:**
- Create: pp/api/auth/dingtalk/cancel/route.ts
- Test: ests/api/dingtalk-cancel.test.ts

- [ ] **Step 1: 写失败测试**

ests/api/dingtalk-cancel.test.ts:

`s
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

let dbReachable = false;
const cleanupIds: string[] = [];

describe("POST /api/auth/dingtalk/cancel", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { prisma } = await import("@/lib/prisma");
    try {
      await prisma.\SELECT 1;
      dbReachable = true;
    } catch {
      dbReachable = false;
    }
  });

  afterAll(async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    if (cleanupIds.length > 0) {
      await prisma.dingtalkLoginCode.deleteMany({ where: { id: { in: cleanupIds } } });
    }
    await prisma.\();
  });

  it("PENDING → EXPIRED", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.dingtalkLoginCode.create({
      data: { state: "test-cancel-1", tmpCode: "tc", expiresAt: new Date(Date.now() + 60_000) },
    });
    cleanupIds.push(row.id);
    const { POST } = await import("@/app/api/auth/dingtalk/cancel/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/cancel", {
      method: "POST", body: JSON.stringify({ state: "test-cancel-1" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
    const after = await prisma.dingtalkLoginCode.findUnique({ where: { id: row.id } });
    expect(after!.status).toBe("EXPIRED");
  });

  it("state 不存在 → 静默 200", async () => {
    if (!dbReachable) return;
    const { POST } = await import("@/app/api/auth/dingtalk/cancel/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/cancel", {
      method: "POST", body: JSON.stringify({ state: "missing" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
  });

  it("已 CONSUMED → 不动(静默 200)", async () => {
    if (!dbReachable) return;
    const { prisma } = await import("@/lib/prisma");
    const row = await prisma.dingtalkLoginCode.create({
      data: {
        state: "test-cancel-consumed", tmpCode: "tc", status: "CONSUMED",
        expiresAt: new Date(Date.now() + 60_000), consumedAt: new Date(),
      },
    });
    cleanupIds.push(row.id);
    const { POST } = await import("@/app/api/auth/dingtalk/cancel/route");
    const res = await POST(new Request("http://x/api/auth/dingtalk/cancel", {
      method: "POST", body: JSON.stringify({ state: "test-cancel-consumed" }),
      headers: { "content-type": "application/json" },
    }));
    expect(res.status).toBe(200);
    const after = await prisma.dingtalkLoginCode.findUnique({ where: { id: row.id } });
    expect(after!.status).toBe("CONSUMED");
  });
});
`

- [ ] **Step 2: 跑测试看红**

`ash
npm test -- tests/api/dingtalk-cancel.test.ts
`

Expected: FAIL(Cannot find module '@/app/api/auth/dingtalk/cancel/route')。

- [ ] **Step 3: 实现 route**

pp/api/auth/dingtalk/cancel/route.ts:

`s
import { ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { runWithRequestContext } from "@/lib/request-context";

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    const body = (await req.json().catch(() => ({}))) as { state?: string };
    if (!body.state) return ok({ ok: true });
    await prisma.dingtalkLoginCode.updateMany({
      where: { state: body.state, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    return ok({ ok: true });
  });
}
`

- [ ] **Step 4: 跑测试看绿**

`ash
npm test -- tests/api/dingtalk-cancel.test.ts
npm run typecheck
`

Expected: 3 个 case 全过。

- [ ] **Step 5: Commit**

`ash
git add app/api/auth/dingtalk/cancel/route.ts tests/api/dingtalk-cancel.test.ts
git commit -m "feat(auth): /api/auth/dingtalk/cancel endpoint"
`

---

## Task 10: i18n 文案 + 前端登录页钉钉面板

**Files:**
- Modify: lib/i18n.ts (加 12 条 login.dingtalk.* 文案)
- Modify: pp/login/page.tsx (在表单后插「钉钉扫码」面板,enabled=false 时隐藏)
- Modify: pp/login/login.module.css (加二维码面板样式)
- Modify: package.json (加 qrcode 依赖)
- Test: 
pm run dev + 手测(spec §10.3 checklist)

- [ ] **Step 1: 加 npm 依赖**

`ash
npm install qrcode
npm install -D @types/qrcode
`

Expected: package.json + package-lock.json 改动,无错。

- [ ] **Step 2: 在 lib/i18n.ts 的 messages["zh-CN"] 加 12 条**

在 zh-CN 末尾追加:

`s
    // 钉钉登录
    "login.dingtalk.button": "使用钉钉扫码登录",
    "login.dingtalk.qrHint": "请用钉钉 App 扫一扫",
    "login.dingtalk.expired": "二维码已过期,请点击刷新",
    "login.dingtalk.cancelled": "已在手机上取消登录",
    "login.dingtalk.unbound": "该钉钉账号未关联系统用户,请联系管理员",
    "login.dingtalk.unavailable": "钉钉登录暂不可用",
    "login.dingtalk.bind": "首次登录将自动绑定您的钉钉账号",
    "login.dingtalk.refresh": "刷新二维码",
    "login.dingtalk.separator": "或",
    "login.dingtalk.unavailableTip": "请联系管理员配置钉钉登录",
    "login.dingtalk.loading": "正在加载二维码…",
    "login.dingtalk.tab": "扫码登录",
`

在 messages["en-US"] 加对应英文(本期 en-US 文案先做骨架,留 key;后续 i18n 任务扩):

`s
    "login.dingtalk.button": "Sign in with DingTalk",
    "login.dingtalk.qrHint": "Scan with DingTalk",
    "login.dingtalk.expired": "QR code expired, please refresh",
    "login.dingtalk.cancelled": "Login cancelled on phone",
    "login.dingtalk.unbound": "This DingTalk account is not linked. Please contact your administrator.",
    "login.dingtalk.unavailable": "DingTalk login is currently unavailable",
    "login.dingtalk.bind": "First sign-in will automatically link your DingTalk account",
    "login.dingtalk.refresh": "Refresh QR code",
    "login.dingtalk.separator": "or",
    "login.dingtalk.unavailableTip": "Please ask your administrator to configure DingTalk sign-in",
    "login.dingtalk.loading": "Loading QR code…",
    "login.dingtalk.tab": "QR Login",
`

- [ ] **Step 3: 在 pp/login/page.tsx 加组件**

在文件顶部加 imports(在已有 signIn 之后):

`sx
import QRCode from "qrcode";
import { useT } from "@/lib/i18n";
import { useEffect } from "react";
`

加 imports 中加 QrcodeOutlined:

`sx
import { ..., QrcodeOutlined } from "@ant-design/icons";
`

加客户端组件(放在文件 LoginForm 之后、Narrative 之前):

`sx
function DingtalkLoginPanel() {
  const t = useT();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [qrcodeUrl, setQrcodeUrl] = useState<string | null>(null);
  const [state, setState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // 1) 探测 enabled
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/auth/dingtalk/enabled");
        const j = await r.json();
        if (!cancelled) setEnabled(Boolean(j.data?.enabled));
      } catch {
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // 2) enabled 后拉二维码
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const r = await fetch("/api/auth/dingtalk/qrcode");
        if (!r.ok) {
          const j = await r.json();
          setError(j.message ?? t("login.dingtalk.unavailable"));
          return;
        }
        const j = await r.json();
        if (cancelled) return;
        setQrcodeUrl(j.data.qrcodeUrl);
        setState(j.data.state);
      } catch {
        setError(t("login.dingtalk.unavailable"));
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // 3) 渲染二维码到 canvas
  useEffect(() => {
    if (!qrcodeUrl) return;
    const canvas = document.getElementById("dingtalk-qr") as HTMLCanvasElement | null;
    if (!canvas) return;
    QRCode.toCanvas(canvas, qrcodeUrl, { width: 220, margin: 1 }).catch(() => undefined);
  }, [qrcodeUrl]);

  // 4) 轮询
  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (cancelled) return;
      try {
        const r = await fetch(/api/auth/dingtalk/poll?state=\);
        const j = await r.json();
        const status = j.data?.status;
        if (status === "EXPIRED") {
          setError(t("login.dingtalk.expired"));
          clearInterval(timer);
        } else if (status === "CANCELLED") {
          setError(t("login.dingtalk.cancelled"));
          clearInterval(timer);
        } else if (status === "READY") {
          clearInterval(timer);
          const f = await fetch("/api/auth/dingtalk/finish", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ state }),
          });
          if (f.ok) {
            router.push("/dashboard");
            router.refresh();
          } else {
            const fj = await f.json();
            setError(fj.message ?? t("login.dingtalk.unbound"));
          }
        }
      } catch {
        // swallow; next tick will retry
      }
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  if (enabled === null) return null;
  if (!enabled) return null;

  async function refresh() {
    setState(null);
    setQrcodeUrl(null);
    setError(null);
    try {
      const r = await fetch("/api/auth/dingtalk/qrcode");
      if (!r.ok) { setError(t("login.dingtalk.unavailable")); return; }
      const j = await r.json();
      setQrcodeUrl(j.data.qrcodeUrl);
      setState(j.data.state);
    } catch {
      setError(t("login.dingtalk.unavailable"));
    }
  }

  return (
    <div className={styles.dingtalkPanel}>
      <div className={styles.dingtalkSep}>
        <span>{t("login.dingtalk.separator")}</span>
      </div>
      <Button
        type="default"
        size="large"
        block
        icon={<QrcodeOutlined />}
        onClick={refresh}
      >
        {qrcodeUrl ? t("login.dingtalk.refresh") : t("login.dingtalk.button")}
      </Button>
      {qrcodeUrl && (
        <div className={styles.dingtalkQrWrap}>
          <canvas id="dingtalk-qr" />
          <p className={styles.dingtalkHint}>{t("login.dingtalk.qrHint")}</p>
          <p className={styles.dingtalkBind}>{t("login.dingtalk.bind")}</p>
        </div>
      )}
      {error && <p className={styles.dingtalkError}>{error}</p>}
    </div>
  );
}
`

在 LoginPage 内的 </section> (formCard) 之后,<footer> 之前插入 <DingtalkLoginPanel />:

`sx
            <DingtalkLoginPanel />
`

- [ ] **Step 4: 在 pp/login/login.module.css 加样式**

文件末尾追加:

`css
/* 钉钉扫码面板 */
.dingtalkPanel {
  margin-top: 22px;
}

.dingtalkSep {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 14px 0 18px;
  font-size: 12px;
  color: #86868B;
  letter-spacing: 0.02em;
}

.dingtalkSep::before,
.dingtalkSep::after {
  content: "";
  flex: 1;
  height: 1px;
  background: rgba(0, 0, 0, 0.08);
}

.dingtalkQrWrap {
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 18px 12px;
  background: #F5F5F7;
  border-radius: 12px;
}

.dingtalkQrWrap canvas {
  border-radius: 6px;
  background: #FFFFFF;
  padding: 6px;
}

.dingtalkHint {
  margin: 0;
  font-size: 13px;
  color: #1D1D1F;
  font-weight: 500;
}

.dingtalkBind {
  margin: 0;
  font-size: 11.5px;
  color: #6E6E73;
}

.dingtalkError {
  margin: 12px 0 0;
  font-size: 12.5px;
  color: #C42B1C;
  text-align: center;
}
`

- [ ] **Step 5: typecheck + 启动 dev 手测**

`ash
npm run typecheck
npm run dev
`

打开 http://localhost:3000/login:
- dev 未配 DINGTALK_APP_KEY/SECRET → 应**完全**不显示钉钉面板(只剩工号+密码)。
- .env 临时加 DINGTALK_APP_KEY=test DINGTALK_APP_SECRET=test → 应显示「使用钉钉扫码登录」按钮,但点 qrcode 会返 502(因为 test 凭证调真 upstream 失败),这是**预期**;**仅**验证面板渲染与 enabled 切换正确。

- [ ] **Step 6: Commit**

`ash
git add package.json package-lock.json lib/i18n.ts app/login/page.tsx app/login/login.module.css
git commit -m "feat(auth): login page dingtalk qr panel + i18n"
`

---

## Task 11: cron 清理 DingtalkLoginCode

**Files:**
- Create: server/jobs/clean-expired-dingtalk-codes.ts
- Modify: server/jobs/runner.ts (注册新 job)
- Test: ests/unit/server/clean-expired-dingtalk-codes.test.ts

- [ ] **Step 1: 写失败测试**

ests/unit/server/clean-expired-dingtalk-codes.test.ts:

`s
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { runCleanExpiredDingtalkCodes } from "@/server/jobs/clean-expired-dingtalk-codes";

let dbReachable = false;
const createdIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.\SELECT 1;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  if (createdIds.length > 0) {
    await prisma.dingtalkLoginCode.deleteMany({ where: { id: { in: createdIds } } });
  }
  await prisma.\();
});

describe("cleanExpiredDingtalkCodes", () => {
  it("删 PENDING/EXPIRED 且 expiresAt < now-1d 的行", async () => {
    if (!dbReachable) return;
    const oldPending = await prisma.dingtalkLoginCode.create({
      data: { state: "test-old-pending", tmpCode: "x", status: "PENDING", expiresAt: new Date(Date.now() - 2 * 86400_000) },
    });
    const oldExpired = await prisma.dingtalkLoginCode.create({
      data: { state: "test-old-expired", tmpCode: "x", status: "EXPIRED", expiresAt: new Date(Date.now() - 2 * 86400_000) },
    });
    const newPending = await prisma.dingtalkLoginCode.create({
      data: { state: "test-new-pending", tmpCode: "x", status: "PENDING", expiresAt: new Date(Date.now() + 60_000) },
    });
    const consumed = await prisma.dingtalkLoginCode.create({
      data: { state: "test-old-consumed", tmpCode: "x", status: "CONSUMED", expiresAt: new Date(Date.now() - 2 * 86400_000) },
    });
    createdIds.push(newPending.id, consumed.id);

    const r = await runCleanExpiredDingtalkCodes();
    expect(r.deleted).toBeGreaterThanOrEqual(2);

    const after = await prisma.dingtalkLoginCode.findMany({ where: { id: { in: [oldPending.id, oldExpired.id] } } });
    expect(after.length).toBe(0);
    const keptNew = await prisma.dingtalkLoginCode.findUnique({ where: { id: newPending.id } });
    expect(keptNew).toBeTruthy();
    const keptConsumed = await prisma.dingtalkLoginCode.findUnique({ where: { id: consumed.id } });
    expect(keptConsumed).toBeTruthy();
  });
});
`

- [ ] **Step 2: 跑测试看红**

`ash
npm test -- tests/unit/server/clean-expired-dingtalk-codes.test.ts
`

Expected: FAIL(Cannot find module '@/server/jobs/clean-expired-dingtalk-codes')。

- [ ] **Step 3: 实现 server/jobs/clean-expired-dingtalk-codes.ts**

`s
// 每天清 DingtalkLoginCode 中过期且未消费的临时码
import { prisma } from "@/lib/prisma";

const BATCH_LIMIT = 1000;
const KEEP_DAYS = 1;

export type CleanResult = { deleted: number };

export async function runCleanExpiredDingtalkCodes(): Promise<CleanResult> {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 86400_000);
  const r = await prisma.dingtalkLoginCode.deleteMany({
    where: {
      status: { in: ["PENDING", "EXPIRED", "CANCELLED"] },
      expiresAt: { lt: cutoff },
    },
  });
  return { deleted: r.count };
}
`

- [ ] **Step 4: 在 server/jobs/runner.ts 注册新 job**

在 unAllJobs 的 jobs 数组里追加(在最后一个 certificate-expiry-check 之后):

`s
    {
      name: "clean-expired-dingtalk-codes",
      run: async () => {
        const r = await runCleanExpiredDingtalkCodes();
        return { job: "clean-expired-dingtalk-codes", created: 0, scanned: 0, updated: r.deleted, durationMs: 0 };
      }
    }
`

并在文件顶部加 import:

`s
import { runCleanExpiredDingtalkCodes } from "@/server/jobs/clean-expired-dingtalk-codes";
`

- [ ] **Step 5: 跑测试看绿 + typecheck**

`ash
npm test -- tests/unit/server/clean-expired-dingtalk-codes.test.ts
npm run typecheck
`

Expected: 1 个 case 全过(DB skip 守卫)。

- [ ] **Step 6: Commit**

`ash
git add server/jobs/clean-expired-dingtalk-codes.ts server/jobs/runner.ts tests/unit/server/clean-expired-dingtalk-codes.test.ts
git commit -m "feat(auth): cron job clean-expired-dingtalk-codes"
`

---

## Task 12: Playwright E2E + 部署文档

**Files:**
- Create: ests/e2e/16-dingtalk-login.spec.ts
- Modify: docs/阿里云 ECS 单主机部署方案 — qt-biz v0.1.0.md (加钉钉配置小节)

- [ ] **Step 1: 写 Playwright E2E**

ests/e2e/16-dingtalk-login.spec.ts:

`s
// E2E 验证钉钉扫码登录全流程;通过 page.route 拦截钉钉 upstream 模拟确认/未确认/取消
import { test, expect, type Page } from "@playwright/test";

const DINGTALK_HOST = "**/oapi.dingtalk.com/**";

async function mockDingtalkUpstream(page: Page, opts: { confirmed: boolean; mobile: string; unionid: string }) {
  await page.route(DINGTALK_HOST, async (route) => {
    const url = route.request().url();
    if (url.includes("/gettoken")) {
      return route.fulfill({ json: { access_token: "fake_token", expires_in: 7200 } });
    }
    if (url.includes("/sns_authorize")) {
      return route.fulfill({ json: { tmpCode: "fake_tmp", expiresIn: 180, qrcodeUrl: "https://example.com/qr" } });
    }
    if (url.includes("/sns_token")) {
      if (opts.confirmed) {
        return route.fulfill({ json: { status: "CONFIRMED", authCode: "fake_auth" } });
      }
      return route.fulfill({ json: { status: "PENDING" } });
    }
    if (url.includes("/user/getuserinfo")) {
      return route.fulfill({ json: { result: { userid: opts.unionid } } });
    }
    if (url.includes("/user/get")) {
      return route.fulfill({ json: { result: { mobile: opts.mobile, nick: "Test" } } });
    }
    return route.continue();
  });
}

test.describe("钉钉扫码登录", () => {
  test.skip(!process.env.DINGTALK_APP_KEY, "未配置 DINGTALK_APP_KEY,跳过 E2E");

  test("happy path:扫码确认 → 跳 /dashboard 或未关联(取决于 admin.phone)", async ({ page }) => {
    const adminMobile = "13800000001";
    await mockDingtalkUpstream(page, { confirmed: true, mobile: adminMobile, unionid: "test_e2e_uid" });

    await page.goto("/login");
    await expect(page.getByText("使用钉钉扫码登录")).toBeVisible();
    await page.getByText("使用钉钉扫码登录").click();
    await expect(page.locator("#dingtalk-qr")).toBeVisible();
    await Promise.race([
      page.waitForURL(/dashboard/, { timeout: 10000 }),
      page.getByText("未关联").waitFor({ timeout: 10000 }).catch(() => null),
    ]);
  });

  test("手机号未注册 → 显示 unbound 提示", async ({ page }) => {
    await mockDingtalkUpstream(page, { confirmed: true, mobile: "19900000000", unionid: "test_e2e_orphan" });
    await page.goto("/login");
    await page.getByText("使用钉钉扫码登录").click();
    await expect(page.locator("#dingtalk-qr")).toBeVisible();
    await expect(page.getByText("未关联系统用户")).toBeVisible({ timeout: 10000 });
  });
});
`

- [ ] **Step 2: 手测 (本地浏览器)**

按 spec §10.3 checklist 跑一遍,贴 PR 描述:

- [ ] dev 未配 → 钉钉入口**完全**不显示
- [ ] dev 配好 → 扫码成功跳 /dashboard
- [ ] 未注册手机号 → 「未关联」提示
- [ ] 手工把 DingtalkLoginCode.expiresAt 改到过去 → poll 返 EXPIRED
- [ ] admin 禁用某 dev 账号 → 该账号钉钉登录返 DINGTALK_USER_DISABLED
- [ ] OperationLog 有 dingtalk_bind (首次) / dingtalk_login (后续) 记录

- [ ] **Step 3: 部署文档加钉钉配置小节**

打开 docs/阿里云 ECS 单主机部署方案 — qt-biz v0.1.0.md,在「六、新增/修改文件清单」表后追加一节:

`markdown
### 钉钉扫码登录配置 (可选)

钉钉登录为可选项,缺 \DINGTALK_APP_KEY\ / \DINGTALK_APP_SECRET\ 时登录页自动隐藏入口。

1. 在 https://open-dev.dingtalk.com/ 创建企业内部应用
2. 「应用信息」 → 复制 AppKey / AppSecret 填入 \/opt/qt/.env\:
   \\\ash
   DINGTALK_APP_KEY="<your_app_key>"
   DINGTALK_APP_SECRET="<your_app_secret>"
   DINGTALK_LOGIN_SCOPE="snsapi_login"
   \\\
3. 「安全设置」 → 勾选「扫码登录」并配置回调域为本服务的 \NEXTAUTH_URL\
4. 确认 admin 在用户管理中给每个员工的 \User.phone\ 字段填入钉钉登记的手机号
5. \systemctl restart qt-app\ 即可生效

**回滚:** 删 \/opt/qt/.env\ 里的 \DINGTALK_*\ 三行 + \systemctl restart qt-app\ 即可,不删表/不删列。
`

- [ ] **Step 4: 全量 typecheck + lint**

`ash
npm run typecheck
npm run lint
`

Expected: 0 错(若 lint 有 rule 触发,逐条按现有 .eslintrc 风格修)。

- [ ] **Step 5: Commit**

`ash
git add tests/e2e/16-dingtalk-login.spec.ts "docs/阿里云 ECS 单主机部署方案 — qt-biz v0.1.0.md"
git commit -m "test(e2e): dingtalk login happy path + unbound + docs"
`

---

## Self-Review Checklist

1. **Spec coverage:**
   - [x] 1.2 目标 1:扫码即登 + 自动绑定 → Task 8 finish
   - [x] 1.2 目标 2:复用 NextAuth JWT + loadActiveUser → Task 8 (新建本地 loadActiveUser,与 lib/auth.ts 同形,**不**改 lib/auth.ts)
   - [x] 1.2 目标 3:env 缺则登录页自动隐藏 → Task 5 enabled + Task 10 面板
   - [x] 2.1 流程总览 → Task 4-9 完整链路
   - [x] 3.1 UserIdentity 表 + GRANT → Task 3 迁移
   - [x] 3.2 User.dingtalkBoundAt → Task 3 迁移
   - [x] 3.3 DingtalkLoginCode 表 + GRANT → Task 3 迁移
   - [x] 4.1 qrcode → Task 6
   - [x] 4.2 poll → Task 7
   - [x] 4.3 finish (含事务边界钉死) → Task 8
   - [x] 4.4 cancel → Task 9
   - [x] 4.5 env 三个 key + isDingtalkEnabled() → Task 1
   - [x] 5 鉴权/角色/缓存复用 (loadActiveUser 5s TTL 不动) → 不写代码
   - [x] 6.1 OperationLog 4 个写入点 → Task 7 poll FAILURE 写、Task 8 login/bind SUCCESS 写
   - [x] 7 9 个错误码 → Task 2
   - [x] 8.1 前端面板 → Task 10
   - [x] 8.2 i18n 12 条 → Task 10
   - [x] 9 安全考量 (state 32B、乐观锁、unionid 唯一) → Task 3 unique、Task 8 乐观锁
   - [x] 10.1 Vitest 9 个 → 拆到 Task 5(1) + 6(3) + 7(5) + 8(7) + 9(3) + 11(1) + Task 1(3) + Task 2(9) = 32 个 case (超额覆盖)
   - [x] 10.2 Playwright E2E → Task 12
   - [x] 11.1 迁移 → Task 3
   - [x] 11.2 env 注释 + 部署文档 → Task 1 + Task 12
   - [x] 11.3 清理 cron → Task 11
   - [x] 12 风险 (User.phone NOT NULL UNIQUE) → Task 3 迁移

2. **Placeholder scan:**
   - [x] 无 TBD/TODO
   - [x] 无 "handle edge cases" 留白 — 所有异常分支都给出具体错误码和返回
   - [x] "audit() signature null actor" 在 Task 7 Step 0 明确说明需 patch lib/audit.ts
   - [x] 实际代码在每个 step 里完整给出
   - [x] 类型一致:loadActiveUser 在 Task 8 是**新**的本地函数(同形),不影响 lib/auth.ts 里的同名私有函数

3. **Type consistency:**
   - UserIdentity schema 字段名 (provider / providerUserId / mobileSnapshot / unionidSnapshot / boundAt / boundBy) 在 Task 3 schema.prisma / 迁移 SQL / Task 8 finish 三处一致
   - DingtalkLoginCode 状态机字符串 (PENDING / CONFIRMED / READY / CONSUMED / EXPIRED / CANCELLED) 在 Task 3 schema / 迁移 / Task 6 qrcode / Task 7 poll / Task 8 finish / Task 9 cancel 六处一致
   - DINGTALK_* 错误码字符串 (9 个) 在 Task 2 ERROR_CODES / Task 5 enabled / Task 6 qrcode / Task 7 poll / Task 8 finish / Task 9 cancel 六处一致
   - isDingtalkEnabled() 签名 (env) => boolean 在 Task 1 测试 / Task 5 route / Task 6 route 三处一致
   - getQrCode() / pollQrCode() / getUserInfoByAuthCode() 签名在 Task 4 测试 / Task 6/7/8 route 四处一致
   - cookieName (
ext-auth.session-token / __Secure-next-auth.session-token) 在 Task 8 route 单一来源
   - 测试 helper dbReachable 模式从 ests/api/app-release.test.ts:21-32 复用

## Execution Handoff

计划已完成,保存在 docs/superpowers/plans/2026-07-05-dingtalk-login.md。

**两种执行方式:**

1. **Subagent 驱动(推荐)** — 我按 task 派发新的子代理,在任务间 review,迭代更快。

2. **内联执行** — 在当前会话中用 superpowers:executing-plans 执行,带检查点的批量执行。

你想用哪种?
