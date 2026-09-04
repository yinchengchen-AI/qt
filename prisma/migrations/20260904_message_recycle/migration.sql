-- 消息回收站：Message 表新增 deletedAt 列，支持软删 + 30 天后定时硬删
-- (v0.24.0 消息归档与回收站统一重做)
--
-- 设计要点：
--   - deletedAt 为 NULL 表示在 inbox；非 NULL 表示已软删进入回收站
--   - 部分索引只走"未清空"行（绝大多数 Message.deletedAt IS NULL 走全表扫描更便宜）
--   - receiverUserId + deletedAt 复合索引覆盖"用户自己看回收站"的高频查询
--   - qt_app 已有表级 GRANT，新列自动覆盖，无需重复 GRANT

BEGIN;

ALTER TABLE "Message"
  ADD COLUMN "deletedAt" TIMESTAMP(6) WITH TIME ZONE NULL;

-- 部分索引: 只索引已软删的行, 大幅降低常驻 inbox 的索引成本
CREATE INDEX "Message_deletedAt_idx"
  ON "Message"("deletedAt")
  WHERE "deletedAt" IS NOT NULL;

-- 用户维度的回收站查询(过滤条件 receiverUserId = ? AND deletedAt IS NOT NULL)
CREATE INDEX "Message_receiverUserId_deletedAt_idx"
  ON "Message"("receiverUserId", "deletedAt");

COMMIT;
