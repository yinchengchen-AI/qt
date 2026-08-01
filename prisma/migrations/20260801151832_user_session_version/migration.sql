-- User 加 sessionVersion 列 (default 0): 登录时 +1, 用于强制单点登录
-- (新登录踢掉所有旧设备的 JWT; admin 主动踢人也 +1)
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
