-- =====================================================
-- 合同状态机简化: 7 个值 → 3 个值
--   ACTIVE  = 原 EFFECTIVE / EXECUTING / SUSPENDED / PENDING_REVIEW
--   CLOSED  = 原 COMPLETED / TERMINATED / EXPIRED
--   DRAFT   = 维持
--
-- 备份: 旧 status 落到 _Contract_status_simplify_bak, 便于回滚或排查
-- =====================================================

BEGIN;

-- 1) 备份原 status
CREATE TABLE IF NOT EXISTS "_Contract_status_simplify_bak" (
  "id" TEXT NOT NULL,
  "status_old" TEXT NOT NULL,
  "backedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("id")
);
INSERT INTO "_Contract_status_simplify_bak" ("id", "status_old")
SELECT "id", "status" FROM "Contract"
ON CONFLICT ("id") DO UPDATE SET "status_old" = EXCLUDED."status_old", "backedAt" = NOW();

-- 2) 推平到 3 态
UPDATE "Contract" SET "status" = 'ACTIVE'
  WHERE "status" IN ('EFFECTIVE', 'EXECUTING', 'SUSPENDED', 'PENDING_REVIEW');

UPDATE "Contract" SET "status" = 'CLOSED'
  WHERE "status" IN ('COMPLETED', 'TERMINATED', 'EXPIRED');

-- 3) 断言: status 必须收敛到 3 个值
DO $$
DECLARE
  bad_count int;
BEGIN
  SELECT COUNT(*) INTO bad_count
    FROM "Contract"
   WHERE "status" NOT IN ('DRAFT', 'ACTIVE', 'CLOSED');
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'Contract.status 仍有 % 行不在新枚举中, 回滚', bad_count;
  END IF;
END$$;

-- 4) 状态分布报告 (写到 DO block 之外的 SELECT, 仅作记录, 不阻塞迁移)
DO $$
DECLARE
  cnt_draft int; cnt_active int; cnt_closed int;
BEGIN
  SELECT COUNT(*) INTO cnt_draft   FROM "Contract" WHERE "status" = 'DRAFT';
  SELECT COUNT(*) INTO cnt_active  FROM "Contract" WHERE "status" = 'ACTIVE';
  SELECT COUNT(*) INTO cnt_closed  FROM "Contract" WHERE "status" = 'CLOSED';
  RAISE NOTICE 'Contract.status 分布: DRAFT=%, ACTIVE=%, CLOSED=%', cnt_draft, cnt_active, cnt_closed;
END$$;

COMMIT;
