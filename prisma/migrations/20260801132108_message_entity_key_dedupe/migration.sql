-- Message 行级去重:加 entityKey 列 + unique
-- (entityKey, receiverUserId):同一业务实体 + 同一接收人只能一条 inbox 消息。

-- 1) 新列 (nullable,deprecated / 无 link 的老消息可以为空)
ALTER TABLE "Message" ADD COLUMN "entityKey" VARCHAR(500);

-- 2) Backfill:有 link.id 的历史行写入 entityKey
UPDATE "Message"
SET "entityKey" = type || ':' || (link ->> 'id')
WHERE link IS NOT NULL
  AND jsonb_typeof(link) = 'object'
  AND (link ? 'id')
  AND (link ->> 'id') IS NOT NULL
  AND char_length(type || ':' || (link ->> 'id')) <= 500;

-- 3) 去重:同一个 (entityKey, receiverUserId) 仅保留最早一条(行级 unique 兜底)
-- 历史环境里可能会出现两个或以上重复,keep_min 保证迁移可执行:
DELETE FROM "Message" m
USING "Message" dup
WHERE m."entityKey" = dup."entityKey"
  AND m."receiverUserId" = dup."receiverUserId"
  AND m."createdAt" > dup."createdAt";

-- 4) 普通 btree unique (Prisma 用 @@unique 生成)。 NULL 多行天然不冲突。
CREATE UNIQUE INDEX "Message_entityKey_receiverUserId_key"
  ON "Message" ("entityKey", "receiverUserId");
