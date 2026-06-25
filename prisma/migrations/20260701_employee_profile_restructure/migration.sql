-- =====================================================
-- 员工档案重构:5 张子表 + EmployeeProfile 字段调整
-- + Attachment.category + MessageType.CERTIFICATE_EXPIRING
--
-- 对应 plan: docs/superpowers/plans/2026-06-25-employee-profile-redesign.md Task 1
-- 对应 spec: docs/superpowers/specs/2026-06-25-employee-profile-redesign-design.md §2
-- 回滚脚本: 同目录 rollback.sql
--
-- 顺序:
--   1. 备份旧字段到 _legacy_* (用于 PR3 迁移脚本或人工数据恢复)
--   2. 拆 address → addressDetail (省市区无法解析, 留 NULL)
--   3. 加 avatarAttachmentId (1:1 Attachment)
--   4. 加 5 张子表 + 索引
--   5. 把旧长文本作为子表第 1 行的 remark
--   6. Attachment 加 category 字段
--   7. MessageType 加 CERTIFICATE_EXPIRING (ALTER TYPE)
--   8. 删旧字段 (workExperience / educationHistory / certificates /
--                address / emergencyContactName / emergencyContactPhone)
--   9. 删 _legacy_* (回滚用,但已落子表,保留 30 天以防 PR3 误删)
--
-- 兼容性: PG 16; Prisma migrate dev 自动包事务.
-- ALTER TYPE ... ADD VALUE 在 PG 12+ 允许在事务中执行(同事务内不可用),
-- 故本文件保持单事务,按上面顺序排列即可。
-- =====================================================

-- 1. 备份旧字段 (用于 PR3 可能的回滚 / 二次迁移)
ALTER TABLE "EmployeeProfile"
  ADD COLUMN IF NOT EXISTS "_legacy_work_experience" TEXT,
  ADD COLUMN IF NOT EXISTS "_legacy_education_history" TEXT,
  ADD COLUMN IF NOT EXISTS "_legacy_certificates" TEXT,
  ADD COLUMN IF NOT EXISTS "_legacy_emergency_contact_name" TEXT,
  ADD COLUMN IF NOT EXISTS "_legacy_emergency_contact_phone" TEXT;

UPDATE "EmployeeProfile" SET
  "_legacy_work_experience" = "workExperience",
  "_legacy_education_history" = "educationHistory",
  "_legacy_certificates" = "certificates",
  "_legacy_emergency_contact_name" = "emergencyContactName",
  "_legacy_emergency_contact_phone" = "emergencyContactPhone";

-- 2. 拆 address → addressDetail (省市区留 NULL,UI 提示重填)
ALTER TABLE "EmployeeProfile" ADD COLUMN "province" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "city" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "district" TEXT;
ALTER TABLE "EmployeeProfile" ADD COLUMN "addressDetail" TEXT;
UPDATE "EmployeeProfile" SET "addressDetail" = "address" WHERE "address" IS NOT NULL;

-- 3. 加 avatarAttachmentId (1:1 Attachment) + deletedAt (与 User/Customer/Contract 等模型保持软删一致)
ALTER TABLE "EmployeeProfile" ADD COLUMN "avatarAttachmentId" TEXT UNIQUE;
ALTER TABLE "EmployeeProfile" ADD COLUMN "deletedAt" TIMESTAMPTZ(6);
CREATE INDEX "EmployeeProfile_deletedAt_idx" ON "EmployeeProfile"("deletedAt");

-- 4. 加 5 张子表 + 索引
CREATE TABLE "EmployeeEducation" (
  "id" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE,
  "school" TEXT NOT NULL,
  "major" TEXT,
  "degree" TEXT,
  "startDate" TIMESTAMPTZ(6) NOT NULL,
  "endDate" TIMESTAMPTZ(6),
  "isFullTime" BOOLEAN NOT NULL DEFAULT true,
  "remark" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "EmployeeEducation_profileId_idx" ON "EmployeeEducation"("profileId");

CREATE TABLE "EmployeeWorkExperience" (
  "id" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE,
  "company" TEXT NOT NULL,
  "position" TEXT,
  "startDate" TIMESTAMPTZ(6) NOT NULL,
  "endDate" TIMESTAMPTZ(6),
  "leaveReason" TEXT,
  "referrer" TEXT,
  "remark" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "EmployeeWorkExperience_profileId_idx" ON "EmployeeWorkExperience"("profileId");

CREATE TABLE "EmployeeCertificate" (
  "id" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "number" TEXT,
  "issuer" TEXT,
  "issueDate" TIMESTAMPTZ(6),
  "expiryDate" TIMESTAMPTZ(6),
  "attachmentId" TEXT REFERENCES "Attachment"("id") ON DELETE SET NULL,
  "remark" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "EmployeeCertificate_profileId_idx" ON "EmployeeCertificate"("profileId");
CREATE INDEX "EmployeeCertificate_expiryDate_idx" ON "EmployeeCertificate"("expiryDate");

CREATE TABLE "EmployeeSkill" (
  "id" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'INTERMEDIATE',
  "obtainDate" TIMESTAMPTZ(6),
  "remark" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "EmployeeSkill_profileId_idx" ON "EmployeeSkill"("profileId");

CREATE TABLE "EmployeeEmergencyContact" (
  "id" TEXT PRIMARY KEY,
  "profileId" TEXT NOT NULL REFERENCES "EmployeeProfile"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "relationship" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "remark" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMPTZ(6)
);
CREATE INDEX "EmployeeEmergencyContact_profileId_idx" ON "EmployeeEmergencyContact"("profileId");

-- 5. 旧数据迁移:把旧长文本作为子表第 1 行的 remark
-- (a) 工作经历
INSERT INTO "EmployeeWorkExperience" ("id", "profileId", "company", "position", "remark", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", '(历史文本)', NULL, "_legacy_work_experience", now(), now()
FROM "EmployeeProfile"
WHERE "_legacy_work_experience" IS NOT NULL AND "_legacy_work_experience" != '';

-- (b) 教育经历:degree/startDate/isFullTime 是 NOT NULL, 用占位
INSERT INTO "EmployeeEducation" ("id", "profileId", "school", "degree", "startDate", "isFullTime", "remark", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", '(历史文本)', NULL, now(), true, "_legacy_education_history", now(), now()
FROM "EmployeeProfile"
WHERE "_legacy_education_history" IS NOT NULL AND "_legacy_education_history" != '';

-- (c) 证书
INSERT INTO "EmployeeCertificate" ("id", "profileId", "name", "remark", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", '(历史证书)', "_legacy_certificates", now(), now()
FROM "EmployeeProfile"
WHERE "_legacy_certificates" IS NOT NULL AND "_legacy_certificates" != '';

-- (d) 紧急联系人:name / relationship / phone NOT NULL
INSERT INTO "EmployeeEmergencyContact" ("id", "profileId", "name", "relationship", "phone", "remark", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id",
  COALESCE(NULLIF("_legacy_emergency_contact_name", ''), '(未填)'),
  '其他',
  COALESCE("_legacy_emergency_contact_phone", ''),
  NULL, now(), now()
FROM "EmployeeProfile"
WHERE ("_legacy_emergency_contact_name" IS NOT NULL AND "_legacy_emergency_contact_name" != '')
   OR ("_legacy_emergency_contact_phone" IS NOT NULL AND "_legacy_emergency_contact_phone" != '');

-- 6. Attachment 加 category 字段 (默认 GENERAL 兼容历史)
ALTER TABLE "Attachment" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'GENERAL';
CREATE INDEX "Attachment_category_idx" ON "Attachment"("category");

-- 7. MessageType 加 CERTIFICATE_EXPIRING
-- PG 16 允许事务内 ADD VALUE; 同一事务内不能立即用新值,故本 migration
-- 不引入新值数据, 只加枚举成员.
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'CERTIFICATE_EXPIRING';

-- 8. 删旧字段
ALTER TABLE "EmployeeProfile"
  DROP COLUMN "workExperience",
  DROP COLUMN "educationHistory",
  DROP COLUMN "certificates",
  DROP COLUMN "address",
  DROP COLUMN "emergencyContactName",
  DROP COLUMN "emergencyContactPhone";
