-- =====================================================
-- 员工档案重构回滚:把子表数据搬回旧字段
--
-- 注意:
--   - 从子表第 1 行取 remark 复原, 会丢失结构化数据
--   - 仅做"schema 恢复", 不重新跑应用代码 (应用层已在 PR3 改动)
--   - 用途: 严重故障时人工回滚 (30 天窗口)
--   - MessageType 删枚举值需要 `ALTER TYPE ... DROP VALUE`, PG 16 不支持
--     实际生产回滚应回滚到 git 旧 commit, 不要单独跑这个 SQL
-- =====================================================

-- 把子表第 1 行合并回长文本
UPDATE "EmployeeProfile" ep SET
  "workExperience" = COALESCE((SELECT "remark" FROM "EmployeeWorkExperience" WHERE "profileId" = ep.id AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1), ''),
  "educationHistory" = COALESCE((SELECT "remark" FROM "EmployeeEducation" WHERE "profileId" = ep.id AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1), ''),
  "certificates" = COALESCE((SELECT "remark" FROM "EmployeeCertificate" WHERE "profileId" = ep.id AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1), ''),
  "emergencyContactName" = (SELECT "name" FROM "EmployeeEmergencyContact" WHERE "profileId" = ep.id AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1),
  "emergencyContactPhone" = (SELECT "phone" FROM "EmployeeEmergencyContact" WHERE "profileId" = ep.id AND "deletedAt" IS NULL ORDER BY "createdAt" LIMIT 1),
  "address" = NULLIF(CONCAT_WS(' ', "province", "city", "district", "addressDetail"), '');

-- 加回旧字段
ALTER TABLE "EmployeeProfile"
  ADD COLUMN IF NOT EXISTS "workExperience" TEXT,
  ADD COLUMN IF NOT EXISTS "educationHistory" TEXT,
  ADD COLUMN IF NOT EXISTS "certificates" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT,
  ADD COLUMN IF NOT EXISTS "emergencyContactName" TEXT,
  ADD COLUMN IF NOT EXISTS "emergencyContactPhone" TEXT;

-- 删子表
DROP TABLE IF EXISTS "EmployeeEmergencyContact";
DROP TABLE IF EXISTS "EmployeeSkill";
DROP TABLE IF EXISTS "EmployeeCertificate";
DROP TABLE IF EXISTS "EmployeeWorkExperience";
DROP TABLE IF EXISTS "EmployeeEducation";

-- 删新字段
ALTER TABLE "EmployeeProfile" DROP COLUMN IF EXISTS "addressDetail";
ALTER TABLE "EmployeeProfile" DROP COLUMN IF EXISTS "district";
ALTER TABLE "EmployeeProfile" DROP COLUMN IF EXISTS "city";
ALTER TABLE "EmployeeProfile" DROP COLUMN IF EXISTS "province";
ALTER TABLE "EmployeeProfile" DROP COLUMN IF EXISTS "avatarAttachmentId";
DROP INDEX IF EXISTS "EmployeeProfile_deletedAt_idx";
ALTER TABLE "EmployeeProfile" DROP COLUMN IF EXISTS "deletedAt";

-- 删 Attachment 新字段
ALTER TABLE "Attachment" DROP COLUMN IF EXISTS "category";

-- 删备份
ALTER TABLE "EmployeeProfile"
  DROP COLUMN IF EXISTS "_legacy_work_experience",
  DROP COLUMN IF EXISTS "_legacy_education_history",
  DROP COLUMN IF EXISTS "_legacy_certificates",
  DROP COLUMN IF EXISTS "_legacy_emergency_contact_name",
  DROP COLUMN IF EXISTS "_legacy_emergency_contact_phone";
