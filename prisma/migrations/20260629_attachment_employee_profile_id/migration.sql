-- 给 Attachment 加 employeeProfileId 反向关联 (EmployeeProfile 已有但反向关系漏建)
BEGIN;

-- 1) employeeProfileId 列
ALTER TABLE "Attachment" ADD COLUMN IF NOT EXISTS "employeeProfileId" TEXT;

-- 2) 复合索引 (employeeProfileId, deletedAt) - 查员工档案附件用
CREATE INDEX IF NOT EXISTS "Attachment_employeeProfileId_deletedAt_idx"
  ON "Attachment"("employeeProfileId", "deletedAt");

-- 3) 外键
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Attachment_employeeProfileId_fkey'
      AND table_name = 'Attachment'
  ) THEN
    ALTER TABLE "Attachment"
      ADD CONSTRAINT "Attachment_employeeProfileId_fkey"
      FOREIGN KEY ("employeeProfileId") REFERENCES "EmployeeProfile"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4) EmployeeProfile.idCard 的 unique 索引 (schema 标了 @unique,首次建表时漏了)
CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeProfile_idCard_key"
  ON "EmployeeProfile"("idCard");

COMMIT;
