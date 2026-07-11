-- =====================================================
-- 登录安全加固 (2026-07-11)
--
-- 背景:
--   qt-biz 的 employee 登录链路(P1 阶段)目前只有 bcrypt 校验,
--   没有失败计数/IP 限速/锁定/审计/密码自服务重置。
--   见 docs/login-security-review-2026-07-11.md 触发的修复集。
--
-- Schema 变更:
--   User
--     + mustChangePassword  : legacy 迁移 / admin 重置后置 true, 下次登录强制改密
--     + failedLoginCount    : 连续失败计数, 锁定后或成功登录清零
--     + lockedUntil         : 临时锁定到期时间, 过期自动失效
--     + lastFailedLoginAt   : 上次失败时间, 用于衰减窗口判断
--     + roleVersion         : 角色/权限变更时 +1, JWT 携带, 缓存命中检查
--     + lockedUntil 索引     : 鉴权路径上 WHERE lockedUntil > now() 高频查询
--   PasswordResetToken
--     + 新表: 自服务密码重置 token (hash 存储 + 30 分钟过期 + 使用即作废)
--
-- 设计取舍:
--   - 全部 NOT NULL + DEFAULT, 老用户零迁移成本 (PG 把 NULL/缺省按 DEFAULT 填充)
--   - PasswordResetToken 不放 actorId 外键: token 状态在 user 生命周期内独立
--   - 不加 ON UPDATE CASCADE: tokenHash 是凭证, 不应随 user 联动
-- =====================================================

BEGIN;

-- User: 新增 5 个字段 + 1 个索引
ALTER TABLE "User"
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "failedLoginCount"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lockedUntil"        TIMESTAMPTZ(6),
  ADD COLUMN "lastFailedLoginAt"  TIMESTAMPTZ(6),
  ADD COLUMN "roleVersion"        INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "User_lockedUntil_idx" ON "User"("lockedUntil");

-- PasswordResetToken: 新表
CREATE TABLE "PasswordResetToken" (
    "id"                 TEXT NOT NULL,
    "userId"             TEXT NOT NULL,
    "tokenHash"          TEXT NOT NULL,
    "expiresAt"          TIMESTAMPTZ(6) NOT NULL,
    "usedAt"             TIMESTAMPTZ(6),
    "createdAt"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedIp"        TEXT,
    "requestedUserAgent" TEXT,
    "consumedIp"         TEXT,
    "consumedUserAgent"  TEXT,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- 唯一约束: tokenHash 必须唯一 (hash 检索即查重)
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
-- userId 索引: 查某用户所有 token (清理过期 / 列表)
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
-- expiresAt 索引: 定时清理过期 token / WHERE expiresAt > now()
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- FK + 级联删除 (用户被删 → token 一起没)
ALTER TABLE "PasswordResetToken"
  ADD CONSTRAINT "PasswordResetToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

-- qt_app 是 BYPASSRLS 应用运行时用户, BYPASSRLS 只旁路 RLS 不旁路表级权限
-- 新表必须显式 GRANT (AGENTS.md §数据库迁移)
GRANT ALL ON TABLE "PasswordResetToken" TO qt_app;

COMMIT;
