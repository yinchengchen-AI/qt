-- =====================================================
-- AppRelease 加 git 来源字段
--   让"更新日志"从管理员手敲 → git commits 自动翻译成大白话
--   (scripts/release/generate.ts 读 git log → 写库)
--
-- 新增字段:
--   source         : 'MANUAL' (旧/手敲) | 'GIT_COMMITS' (自动)
--                    旧数据全是 MANUAL,迁移不需要回填(默认 'MANUAL')
--   gitFrom        : 起始 commit SHA (短/长都可,VarChar(40) 覆盖 SHA-1)
--   gitTo          : 目标 commit SHA (一般是 HEAD)
--   gitCommitCount : 该 release 覆盖的 commit 数(列表展示"基于 N 个 commit")
--
-- 设计取舍:
--   - 不加 NOT NULL 约束;旧 release 没源,NULL 即可
--   - 不加 enum 类型:AGENTS.md 说 Prisma 7 + enum + @@index 有 wasm 问题,
--     且字符串 + 应用层校验更简单
--   - 单独加 @@index([source]) 是为后续可能按"自动 vs 手动"过滤用的,
--     当前 list 路由不依赖,先建好避免后续大表 ALTER
--   - 不改 in-code ROLE_PERMISSIONS:这次只是字段扩展,API 鉴权不变
-- =====================================================

BEGIN;

ALTER TABLE "AppRelease"
  ADD COLUMN "source"         TEXT NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "gitFrom"        VARCHAR(40),
  ADD COLUMN "gitTo"          VARCHAR(40),
  ADD COLUMN "gitCommitCount" INTEGER;

CREATE INDEX "AppRelease_source_idx" ON "AppRelease"("source");

COMMIT;
