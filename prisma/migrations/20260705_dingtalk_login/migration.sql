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
DO $$
DECLARE
  null_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO null_count FROM "User" WHERE "phone" IS NULL;
  IF null_count > 0 THEN
    RAISE EXCEPTION 'User.phone 存在 % 个 NULL,迁移前请补齐 (spec 强制约束)', null_count;
  END IF;
END $$;

ALTER TABLE "User" ALTER COLUMN "phone" SET NOT NULL;
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

COMMIT;

-- 5) GRANT qt_app (BYPASSRLS 不旁路表级权限)
GRANT ALL ON TABLE "user_identities" TO qt_app;
GRANT ALL ON TABLE "dingtalk_login_codes" TO qt_app;
