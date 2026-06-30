-- 预置 ADMIN 角色, 让 20260621_user_is_system 的 DO 块能找到
--
-- 背景:
--   20260621_user_is_system 的 DO 块通过 SELECT "id" FROM "Role" WHERE "code"='ADMIN'
--   获取 role_id 并在缺失时 RAISE EXCEPTION. 但 ADMIN 角色由 prisma/seed.ts 在
--   `prisma migrate deploy` 之后才写入, 在 fresh DB 上形成死锁:
--     migrate deploy -> 20260621_user_is_system -> DO 块失败 -> 后续 migrations 全挂
--     -> seed 永远没机会跑
--
-- 解决:
--   在 20260621_user_is_system 之前 (按目录名排序) 预置一个 ADMIN 占位角色,
--   让 DO 块能成功. seed.ts 后续会用 upsert 把 permissions 等字段补齐.
--
-- 命名/排序约定 (prisma 按目录名 ASCII 排序):
--   20260621_admin_role_seed            <-- 本迁移 (a < c < u)
--   20260621_contract_no_partial_unique
--   20260621_customer_district
--   20260621_user_is_system             <-- 原本会失败的那条
--
-- 对生产 DB 的影响 (零):
--   - 生产 _prisma_migrations 已有 20260621_user_is_system 标记为 applied
--   - 本迁移是新条目, 第一次跑会 INSERT; 但生产通常已有 ADMIN 角色 (早期通过手工或 seed 写入),
--     ON CONFLICT DO NOTHING 兜底, 不会破坏既有数据
--   - seed.ts 后续 upsert (where: { code: 'ADMIN' }) 会把 permissions/name/description 更新到位
--
-- 对 fresh DB 的影响:
--   - 本迁移先跑, ADMIN 占位行存在
--   - 20260621_user_is_system 的 DO 块找到 ADMIN, 正常 apply
--   - 后续 migrations 顺利 apply, seed.ts 把所有角色/字典/工作流模板补齐
--
-- Role 表结构来自 20260614_init line 27-38:
--   id          TEXT NOT NULL PRIMARY KEY
--   code        TEXT NOT NULL (UNIQUE INDEX "Role_code_key")
--   name        TEXT NOT NULL
--   description TEXT
--   permissions JSONB NOT NULL
--   isSystem    BOOLEAN NOT NULL DEFAULT false
--   createdAt   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
--   updatedAt   TIMESTAMPTZ(6) NOT NULL

INSERT INTO "Role" (
    "id", "code", "name", "description", "permissions", "isSystem", "createdAt", "updatedAt"
) VALUES (
    'admin_role_bootstrap',
    'ADMIN',
    'Administrator (bootstrap)',
    'Pre-seeded by migration 20260621_admin_role_seed to unblock 20260621_user_is_system on fresh DBs. Will be replaced/updated by pnpm seed on first run (id preserved, name/description/permissions refreshed via upsert).',
    '{}'::jsonb,
    true,
    NOW(),
    NOW()
)
ON CONFLICT ("code") DO NOTHING;