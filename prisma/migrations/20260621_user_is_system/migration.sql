-- 合同状态机自动转换 (auto-EXECUTE / auto-EXPIRE) 需要一个 SYSTEM actor
-- 写 OperationLog / ContractReviewLog 用。当前 OperationLog.actorId 和
-- ContractReviewLog.reviewerId 都是非空 String, 用一个稳定的 "system" 用户
-- 充当占位 actor, 配合 User.isSystem=true 在登录/列表路径过滤掉.
--
-- User.passwordHash 是非空, 给 system 用户一个不可登录的 dummy bcrypt hash
-- (bcrypt 永远校验失败, 避免被偶然登录)

BEGIN;

ALTER TABLE "User" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- 找一个 ADMIN 角色 id, system 用户挂到这个角色下 (避免孤儿 FK)
DO $$
DECLARE
  admin_role_id TEXT;
BEGIN
  SELECT "id" INTO admin_role_id FROM "Role" WHERE "code" = 'ADMIN' LIMIT 1;
  IF admin_role_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN role not found; seed roles first';
  END IF;

  -- 用 ON CONFLICT DO NOTHING 兜底, 重复执行迁移不会报错
  INSERT INTO "User" (
    "id", "employeeNo", "name", "email", "passwordHash", "roleId", "status", "isSystem", "createdAt", "updatedAt"
  ) VALUES (
    'system', 'SYSTEM', 'System', 'system@internal.local',
    '$2b$10$ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ',
    admin_role_id, 'ACTIVE', true, NOW(), NOW()
  )
  ON CONFLICT ("id") DO NOTHING;

  -- 如果之前已经存在但 isSystem=false, 修正标记
  UPDATE "User" SET "isSystem" = true WHERE "id" = 'system';
END $$;

COMMIT;
