-- MessageArchive 表:已读超过 90 天的 Message 从主表搬运到这里 (append-only)

CREATE TABLE "MessageArchive" (
  "id"             TEXT NOT NULL,
  "receiverUserId" TEXT NOT NULL,
  "type"           "MessageType" NOT NULL,
  "title"          VARCHAR(200) NOT NULL,
  "content"        VARCHAR(10000) NOT NULL,
  "link"           JSONB,
  "entityKey"      VARCHAR(500),
  "readAt"         TIMESTAMPTZ(6),
  "createdAt"      TIMESTAMPTZ(6) NOT NULL,
  "archivedAt"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageArchive_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageArchive_receiverUserId_archivedAt_idx"
  ON "MessageArchive" ("receiverUserId", "archivedAt");
CREATE INDEX "MessageArchive_type_receiverUserId_archivedAt_idx"
  ON "MessageArchive" ("type", "receiverUserId", "archivedAt");
