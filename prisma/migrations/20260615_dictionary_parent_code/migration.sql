-- =====================================================
-- Dictionary.parentCode: 树形字典自引用
-- 让 REGION 这种 省/市/区/街道 三级结构能真正按树渲染
-- 同时兼容 SERVICE_TYPE 等扁平字典(顶级 parentCode=NULL)
-- =====================================================

ALTER TABLE "Dictionary" ADD COLUMN "parentCode" TEXT;

-- 同 category 内 (parentCode, code) 唯一
-- 注意:已存在 (category, code) 唯一约束,所以顶级(code无parentCode)仍由原约束保唯一
-- 新约束只覆盖子级
CREATE UNIQUE INDEX "Dictionary_category_parentCode_code_key" ON "Dictionary"("category", "parentCode", "code");

-- 查 (category, parentCode) 索引加速树查询
CREATE INDEX "Dictionary_category_parentCode_idx" ON "Dictionary"("category", "parentCode");

-- 历史数据迁移: 给 26 个 REGION 字典条目按 code 编码回填 parentCode
--   顶级 code 形如 R1 (parentCode=NULL) 不动
--   子级 code 形如 R1.2  (parentCode='R1')        / R25.3 (parentCode='R25')
--   孙级 code 形如 R1.2.8 (parentCode='R1.2')     / R25.3.17 (parentCode='R25.3')
-- 我们要支持任意深度,把 parentCode 填成 R{父链 ID} (顶级) 或 R{父链}.{ID} (嵌套)
-- 例: R25.3 顶级父是 R25,所以 parentCode='R25'
--     R25.3.17 不存在 (我们的 26 个都是 ≤2 级)
UPDATE "Dictionary" SET "parentCode" = NULL WHERE "category" = 'REGION' AND "code" ~ '^R[0-9]+$';
UPDATE "Dictionary" SET "parentCode" = REGEXP_REPLACE("code", '\.[0-9]+$', '')
  WHERE "category" = 'REGION' AND "code" ~ '^R[0-9]+\.[0-9]+$';
-- R{父}.{孙} 形: parentCode = 'R{父}'
UPDATE "Dictionary" SET "parentCode" = REGEXP_REPLACE("code", '\.([0-9]+)$', '')
  WHERE "category" = 'REGION' AND "code" ~ '^R[0-9]+\.[0-9]+\.[0-9]+$';
