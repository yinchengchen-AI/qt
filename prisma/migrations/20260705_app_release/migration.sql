-- =====================================================
-- AppRelease + AppReleaseRead
--   应用更新记录:每次发版后,管理员记录本次更新的功能/说明;
--   用户登录后,若该用户尚未"已读"且 release.publishedAt 晚于该用户最近已读时间,
--   在 DashboardShell 弹出更新说明(见 components/release-popup.tsx)。
--
-- 设计要点:
--   - 单一表 AppRelease 存发版元数据;AppReleaseRead 存 per-user 已读时间。
--   - 不挂 RLS: release 内容对所有登录用户可见,无 SALES 行级隔离需求
--     (与 Announcement 决策一致;20260614_init 中 Announcement 同样未启 RLS)。
--   - User.publishedReleases 走 ON DELETE RESTRICT: 防止删除发布人导致历史
--     失主(参考 Announcement.publishUserId 的写法)。
--   - 重要:按 AGENTS.md 规则,新表必须 GRANT 给 qt_app (BYPASSRLS 旁路 RLS,
--     但不旁路表级权限;DunningNote 的 42501 就是历史教训)。
--
-- 同步修改: 5 个内置角色的 Role.permissions JSON,新增 APP_RELEASE 资源。
--   - 运行时 (lib/auth.ts#callbacks.session) 从 in-code ROLE_PERMISSIONS 读,
--     不依赖 DB 列;但 admin/roles 页面的"编辑权限"会读 DB 列展示,不一致会让
--     管理员以为没勾上。所以本迁移把 DB JSON 也补上,保持 UI 跟运行时一致。
--   - 备份 isSystem=true 的 5 个角色,idempotent (DO block 判重, JSON 已含
--     APP_RELEASE 则跳过)。
-- =====================================================

BEGIN;

-- 1) AppRelease 主表
CREATE TABLE "AppRelease" (
  "id"            TEXT NOT NULL,
  "version"       VARCHAR(50) NOT NULL,
  "title"         VARCHAR(200) NOT NULL,
  "summary"       VARCHAR(500) NOT NULL,
  "content"       VARCHAR(10000) NOT NULL,
  "important"     BOOLEAN NOT NULL DEFAULT false,
  "publishedAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedById" TEXT NOT NULL,
  "createdAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMPTZ(6) NOT NULL,
  "deletedAt"     TIMESTAMPTZ(6),
  CONSTRAINT "AppRelease_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AppRelease_publishedAt_idx" ON "AppRelease"("publishedAt");
CREATE INDEX "AppRelease_deletedAt_idx" ON "AppRelease"("deletedAt");
CREATE INDEX "AppRelease_important_publishedAt_idx" ON "AppRelease"("important", "publishedAt");

-- 2) AppReleaseRead:per-user 已读
CREATE TABLE "AppReleaseRead" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "readAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppReleaseRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AppReleaseRead_userId_releaseId_key" ON "AppReleaseRead"("userId", "releaseId");
CREATE INDEX "AppReleaseRead_userId_readAt_idx" ON "AppReleaseRead"("userId", "readAt");
CREATE INDEX "AppReleaseRead_releaseId_idx" ON "AppReleaseRead"("releaseId");

-- 3) 外键
ALTER TABLE "AppRelease" ADD CONSTRAINT "AppRelease_publishedById_fkey"
  FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AppReleaseRead" ADD CONSTRAINT "AppReleaseRead_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppReleaseRead" ADD CONSTRAINT "AppReleaseRead_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "AppRelease"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4) GRANT 给 qt_app (AGENTS.md: 新表必须显式 GRANT)
--   用 DO 块判重:仅在 qt_app 角色存在时执行 GRANT,允许开发环境(无 qt_app)跑通迁移。
--   生产环境 qt_app 必然存在(BYPASSRLS 应用运行时用户),GRANT 必执行。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qt_app') THEN
    GRANT ALL ON TABLE "AppRelease"     TO qt_app;
    GRANT ALL ON TABLE "AppReleaseRead" TO qt_app;
  END IF;
END $$;

-- 5) 把 APP_RELEASE 资源加到 5 个内置角色的 permissions JSON
--    (in-code ROLE_PERMISSIONS 已含,这里只同步 DB 列,保持 admin/roles 页面 UI 一致)
--    用 jsonb 操作把 {resource:'APP_RELEASE', actions: [...]} 追加到数组;已存在则跳过。
--    actions: ADMIN=CRUD, 其它角色=R(只读)
--
-- 写法说明:
--   - 用 WITH ... UPDATE 替代 DO 循环,逐行 UPDATE 更直观,易读 + 易调试
--   - jsonb_build_array 把单个 object 包成 array,然后用 || 拼接(避免与对象 || 对象冲突)
--   - jsonb_typeof='array' + jsonb_array_elements 双保险,防止 permissions 字段格式异常时误改
--   - 全部 WHERE 过滤确保幂等:已含 APP_RELEASE 或 permissions 非数组都不动
WITH role_perms AS (
  SELECT
    "id",
    "code",
    "permissions" AS perm
  FROM "Role"
  WHERE "isSystem" = true
),
to_update AS (
  SELECT
    rp."id",
    rp.perm || jsonb_build_array(
      jsonb_build_object(
        'resource', 'APP_RELEASE',
        'actions',
        CASE WHEN rp."code" = 'ADMIN'
          THEN '["READ","CREATE","UPDATE","DELETE"]'::jsonb
          ELSE '["READ"]'::jsonb
        END
      )
    ) AS new_perm
  FROM role_perms rp
  WHERE jsonb_typeof(rp.perm) = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(rp.perm) elem
      WHERE elem->>'resource' = 'APP_RELEASE'
    )
)
UPDATE "Role" r
   SET "permissions" = tu.new_perm,
       "updatedAt" = NOW()
  FROM to_update tu
 WHERE r."id" = tu."id";

COMMIT;
