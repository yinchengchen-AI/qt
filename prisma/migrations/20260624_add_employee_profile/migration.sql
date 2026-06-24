-- 创建员工档案表，与 User 一对一
BEGIN;

CREATE TABLE IF NOT EXISTS "EmployeeProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "gender" TEXT,
  "birthday" TIMESTAMPTZ(6),
  "idCard" TEXT,
  "education" TEXT,
  "entryDate" TIMESTAMPTZ(6),
  "address" TEXT,
  "emergencyContactName" TEXT,
  "emergencyContactPhone" TEXT,
  "position" TEXT,
  "jobLevel" TEXT,
  "employmentType" TEXT DEFAULT 'FULL_TIME',
  "probationEndDate" TIMESTAMPTZ(6),
  "formalDate" TIMESTAMPTZ(6),
  "resignationDate" TIMESTAMPTZ(6),
  "contractType" TEXT,
  "contractStartDate" TIMESTAMPTZ(6),
  "contractEndDate" TIMESTAMPTZ(6),
  "salary" DECIMAL(14, 2),
  "bankAccount" TEXT,
  "bankName" TEXT,
  "socialSecurityAccount" TEXT,
  "providentFundAccount" TEXT,
  "workExperience" VARCHAR(5000),
  "educationHistory" VARCHAR(5000),
  "certificates" VARCHAR(5000),
  "remark" VARCHAR(5000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmployeeProfile_userId_key" ON "EmployeeProfile"("userId");
CREATE INDEX IF NOT EXISTS "EmployeeProfile_userId_idx" ON "EmployeeProfile"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'EmployeeProfile_userId_fkey'
      AND table_name = 'EmployeeProfile'
  ) THEN
    ALTER TABLE "EmployeeProfile"
      ADD CONSTRAINT "EmployeeProfile_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
