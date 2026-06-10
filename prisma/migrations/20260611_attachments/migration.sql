-- =====================================================
-- Attachments: 新增 Attachment 实体(MinIO 对象存储索引)
-- - objectKey 唯一;实际二进制存到 MinIO
-- - 与 User.uploadedById / Contract.contractId 双向关联
-- - soft delete:deletedAt 不为 null 视为已删,MinIO 对象保留
-- =====================================================

-- 1) 新建 Attachment 表
CREATE TABLE "Attachment" (
    "id"           TEXT NOT NULL,
    "objectKey"    TEXT NOT NULL,
    "bucket"       TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType"     TEXT NOT NULL,
    "size"         INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "contractId"   TEXT,
    "uploadedAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"    TIMESTAMPTZ(6),

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- 2) 唯一索引
CREATE UNIQUE INDEX "Attachment_objectKey_key" ON "Attachment"("objectKey");

-- 3) 业务索引
CREATE INDEX "Attachment_contractId_deletedAt_idx" ON "Attachment"("contractId", "deletedAt");
CREATE INDEX "Attachment_uploadedById_idx" ON "Attachment"("uploadedById");
CREATE INDEX "Attachment_deletedAt_idx" ON "Attachment"("deletedAt");

-- 4) 外键
ALTER TABLE "Attachment"
    ADD CONSTRAINT "Attachment_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;

ALTER TABLE "Attachment"
    ADD CONSTRAINT "Attachment_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "Contract"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
