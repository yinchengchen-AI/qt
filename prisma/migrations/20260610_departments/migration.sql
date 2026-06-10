-- =====================================================
-- 部门管理：新建 Department 实体，迁移 User.department 字符串 → FK
-- =====================================================

-- 1) 新建 Department 表
CREATE TABLE "Department" (
    "id"        TEXT NOT NULL,
    "code"      TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "parentId"  TEXT,
    "sort"      INTEGER NOT NULL DEFAULT 0,
    "isActive"  BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- 2) 唯一索引
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- 3) 自引用 FK(parent → children)
ALTER TABLE "Department"
    ADD CONSTRAINT "Department_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "Department"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;

-- 4) 树形查询索引
CREATE INDEX "Department_parentId_isActive_sort_idx" ON "Department"("parentId", "isActive", "sort");

-- 5) User 加新列 departmentId
ALTER TABLE "User" ADD COLUMN "departmentId" TEXT;
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- 6) 数据迁移：把现有 User.department 唯一值批量建 Department 记录
--    行为：保留原值,code 用 'MIG_' + name 的 base64-ish 短码,保持业务无感
DO $$
DECLARE
    rec RECORD;
    v_code TEXT;
    v_id TEXT;
BEGIN
    FOR rec IN
        SELECT DISTINCT department
        FROM "User"
        WHERE department IS NOT NULL AND department != ''
    LOOP
        -- 短码：MIG_ + 取前 16 字符,大写,去掉空格和特殊字符
        v_code := 'MIG_' ||
            UPPER(
                REGEXP_REPLACE(
                    SUBSTRING(rec.department, 1, 16),
                    '[^A-Za-z0-9]', '_', 'g'
                )
            );
        -- 唯一性兜底:如果碰撞,加 _2/_3 ...
        WHILE EXISTS (SELECT 1 FROM "Department" WHERE "code" = v_code) LOOP
            v_code := v_code || '_' || (RANDOM() * 1000)::INT::TEXT;
        END LOOP;

        v_id := 'mig_' || SUBSTRING(MD5(rec.department), 1, 20);

        INSERT INTO "Department"("id", "code", "name", "parentId", "sort", "isActive", "createdAt", "updatedAt")
        VALUES (v_id, v_code, rec.department, NULL, 0, true, NOW(), NOW())
        ON CONFLICT DO NOTHING;

        -- 关联 User 行
        UPDATE "User" SET "departmentId" = v_id
        WHERE department = rec.department AND "departmentId" IS NULL;
    END LOOP;
END $$;

-- 7) 删旧列
ALTER TABLE "User" DROP COLUMN "department";

-- 8) User.departmentId FK
ALTER TABLE "User"
    ADD CONSTRAINT "User_departmentId_fkey"
    FOREIGN KEY ("departmentId") REFERENCES "Department"("id")
    ON DELETE SET NULL
    ON UPDATE CASCADE;
