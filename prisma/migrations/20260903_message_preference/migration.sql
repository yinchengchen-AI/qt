-- 消息中心 v2：新增用户订阅偏好表
--
-- 设计要点:
--   - 复合主键 (userId, type) 避免同一用户对同类型的多行;
--   - 缺省即视为 enabled=true, 写入策略: 仅在用户明确关闭某类型时才落行;
--   - bus.emit 渲染前会读一次 disabled map 过滤 receivers, 性能成本为单次 in-query。
--   - onDelete: Cascade 与 User 删除一致。
--   - qt_app 需显式获得表权限(BYPASSRLS 旁路 RLS 但不旁路 GRANT)。

BEGIN;

CREATE TABLE "MessagePreference" (
    "userId"    TEXT NOT NULL,
    "type"      "MessageType" NOT NULL,
    "enabled"   BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) WITH TIME ZONE NOT NULL,

    CONSTRAINT "MessagePreference_pkey" PRIMARY KEY ("userId", "type")
);

CREATE INDEX "MessagePreference_userId_idx" ON "MessagePreference"("userId");

ALTER TABLE "MessagePreference"
    ADD CONSTRAINT "MessagePreference_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- qt_app 是 BYPASSRLS 运行时用户, RLS 旁路但 GRANT 必须显式
GRANT ALL ON TABLE "MessagePreference" TO qt_app;

COMMIT;
