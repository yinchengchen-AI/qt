-- =====================================================
-- AnnouncementRead (公告已读回执)
--   仿 AppReleaseRead (20260705_app_release) 的 per-user 已读模式:
--   - unique(userId, announcementId) + upsert 幂等写, 重复上报不刷新 readAt;
--   - FK 两边 Cascade: 公告/用户硬删时随主表清理 (公告软删不受影响);
--   - 无 deletedAt: 已读记录无需软删。
--
-- 按 AGENTS.md 规则: 新表必须显式 GRANT 给 qt_app
--   (BYPASSRLS 只旁路 RLS, 不旁路表级权限; DunningNote 42501 事故教训)。
-- =====================================================

BEGIN;

-- 1) AnnouncementRead: per-user 公告已读
CREATE TABLE "AnnouncementRead" (
  "id"             TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "announcementId" TEXT NOT NULL,
  "readAt"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnnouncementRead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnnouncementRead_userId_announcementId_key" ON "AnnouncementRead"("userId", "announcementId");
CREATE INDEX "AnnouncementRead_userId_readAt_idx" ON "AnnouncementRead"("userId", "readAt");
CREATE INDEX "AnnouncementRead_announcementId_idx" ON "AnnouncementRead"("announcementId");

-- 2) 外键
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AnnouncementRead" ADD CONSTRAINT "AnnouncementRead_announcementId_fkey"
  FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3) GRANT 给 qt_app (DO 块判重: 开发环境无 qt_app 角色时跳过, 生产必执行)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'qt_app') THEN
    GRANT ALL ON TABLE "AnnouncementRead" TO qt_app;
  END IF;
END $$;

COMMIT;
