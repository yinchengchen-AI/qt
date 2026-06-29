-- =====================================================================
-- 合同"假完结"数据修复脚本 (2026-06-29)
-- =====================================================================
-- 背景:
--   cron 任务 (run-all) 2025-09 ~ 2026-06 共 9 个月没正常执行,
--   2026-06-22 恢复后, tryAutoCloseOnOverdue 一次性把 209 个
--   overdue_terminated 合同关掉. 同时库内还有 31 个 admin 手动 SQL
--   关闭但未结清的合同 + 2 个 completed 但其实未结清的合同.
--   合计 242 个 CLOSED 合同未结清, 财务有约 269 万应收被锁死.
--
-- 目的:
--   把这 242 个合同临时改回 ACTIVE, 让财务能补录 Payment,
--   之后由 tryAutoClose 自然走完结 (reason=completed).
--
-- 不直接 "reopen" 是因为代码里没 reopen 接口, 也没有 admin 旁路.
-- 本脚本绕开业务层直接改库, 但有完整审计痕迹, 不会丢历史.
--
-- 适用范围 (242 个合同, 按 reviewComment 分组):
--   overdue_terminated: 209 个, 未结清 1,563,241.29
--   (NULL):             31 个, 未结清 1,099,666.68
--   completed:           2 个, 未结清    30,000.00
--
-- 影响:
--   - Contract.status: CLOSED → ACTIVE (242 条)
--   - 写入 ContractReviewLog (action=MANUAL_REOPEN) 留审计痕迹
--   - reviewComment 改为 'recovered_from_fake_close' (保留审计标记)
--   - 备份原始 CLOSED 状态到 Contract_fake_close_recovery_20260629
--
-- 配套:
--   - 文档: docs/contract-fake-close-recovery.md
--   - 应收清单: docs/contract-fake-close-recovery-list.csv
--   - 可执行 TS 脚本: scripts/migrate/contract-fake-close-recovery.ts
--
-- 使用方法:
--   1) 替换下面 |||OPERATOR_USER_ID||| 为执行操作的 admin 用户 ID
--      (一般可用 ADMIN 角色最近一次登录的用户)
--   2) 先备份整库: pg_dump -Fc qt_biz > /backup/qt_biz_20260629.dump
--   3) 在测试环境跑一遍, 确认影响行数 = 242
--   4) 通知财务暂停录入回款 (执行期间)
--   5) 暂停 cron 任务: sudo systemctl stop qt-app (避免冲突)
--   6) 用 psql 跑这个脚本
--   7) 校验: SELECT count(*) FROM "Contract" WHERE status='ACTIVE' AND "reviewComment"='recovered_from_fake_close'; 应 = 242
--   8) 启动应用: sudo systemctl start qt-app
--   9) 通知财务: 这 242 个合同已恢复 ACTIVE, 可以补录 Payment
--  10) 监控: 次日 cron 跑完后, 钱齐的合同会自动完结 (reason=completed)
--
-- 回滚方法:
--   跑脚本末尾的 "回滚 SQL" 段; 必须先确认 backup 表还在
-- =====================================================================

\set ON_ERROR_STOP on
\timing on

-- 1) 备份: 把 242 个假完结合同的完整原始状态备份到独立表
DROP TABLE IF EXISTS Contract_fake_close_recovery_20260629;
CREATE TABLE Contract_fake_close_recovery_20260629 AS
SELECT
  c.id,
  c."contractNo",
  c.status,
  c."reviewComment",
  c."reviewAt",
  c."updatedAt"           AS closed_at,
  c."updatedById"         AS closed_by,
  c."endDate",
  c."totalAmount",
  c."deletedAt",
  c."ownerUserId",
  c."signerId"
FROM "Contract" c
LEFT JOIN (
  SELECT "contractId", SUM(amount) AS paid
  FROM "Payment" p
  WHERE p.status IN ('CONFIRMED', 'RECONCILED')
    AND p."deletedAt" IS NULL
  GROUP BY "contractId"
) paid ON paid."contractId" = c.id
WHERE c.status = 'CLOSED'
  AND c."deletedAt" IS NULL
  AND c."totalAmount" > COALESCE(paid.paid, 0);

-- 1.1) 校验: 备份表行数应 == 即将被恢复的合同数
DO $$
DECLARE
  backup_count INT;
BEGIN
  SELECT COUNT(*) INTO backup_count FROM Contract_fake_close_recovery_20260629;
  RAISE NOTICE '[备份] Contract_fake_close_recovery_20260629 行数 = %', backup_count;
  IF backup_count < 100 OR backup_count > 300 THEN
    RAISE EXCEPTION '备份表行数 % 异常 (期望 100~300), 中止', backup_count;
  END IF;
END $$;

-- 2) 写 ContractReviewLog (每条合同一行 reopen 记录, 留审计痕迹)
--    reviewerId 用执行操作的管理员 User.id, 见下 |||OPERATOR_USER_ID|||
INSERT INTO "ContractReviewLog" (id, "contractId", "reviewerId", action, comment, at)
SELECT
  'crrl_recover_' || c.id,
  c.id,
  '|||OPERATOR_USER_ID|||'::text,
  'MANUAL_REOPEN',
  format('数据修复:从 %s 恢复为 ACTIVE. 原关闭原因=%s, 原 updatedAt=%s. 触发原因:cron 长期未跑, 误关合同恢复开放补录回款. 详见 docs/contract-fake-close-recovery.md',
         c.status, COALESCE(c."reviewComment", 'NULL'), c."updatedAt"),
  NOW()
FROM "Contract" c
WHERE c.id IN (SELECT id FROM Contract_fake_close_recovery_20260629);

-- 3) 核心操作: CLOSED → ACTIVE
UPDATE "Contract" c
SET
  status = 'ACTIVE',
  "reviewComment" = 'recovered_from_fake_close',
  "updatedById" = '|||OPERATOR_USER_ID|||',
  "updatedAt" = NOW()
WHERE c.id IN (SELECT id FROM Contract_fake_close_recovery_20260629);

-- 4) 校验修改结果
DO $$
DECLARE
  updated_count INT;
  remaining_closed INT;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE '[修改] Contract 表 UPDATE 影响行数 = %', updated_count;

  -- 残留假完结合同数应 = 0
  SELECT COUNT(*) INTO remaining_closed
  FROM "Contract" c
  WHERE c.status = 'CLOSED'
    AND c."deletedAt" IS NULL
    AND c."totalAmount" > COALESCE((
      SELECT SUM(p.amount)
      FROM "Payment" p
      WHERE p."contractId" = c.id
        AND p.status IN ('CONFIRMED', 'RECONCILED')
        AND p."deletedAt" IS NULL
    ), 0);
  IF remaining_closed > 0 THEN
    RAISE EXCEPTION '仍有 % 条假完结合同未被恢复, 中止, 请人工排查', remaining_closed;
  END IF;
  RAISE NOTICE '[校验] 假完结合同残留数 = 0, 通过';
END $$;

-- 5) 输出恢复后的合同清单 (财务对账用, 按应收未结降序)
SELECT
  c."contractNo"                                    AS 合同号,
  c."customerName"                                  AS 客户名,
  c.title                                           AS 合同标题,
  c."totalAmount"::numeric(18,2)                    AS 合同总额,
  COALESCE(paid.paid, 0)::numeric(18,2)             AS 已回款,
  (c."totalAmount" - COALESCE(paid.paid, 0))::numeric(18,2) AS 应收未结,
  c."endDate"                                       AS 合同到期日,
  b.closed_at                                       AS 原始关闭时间,
  c.status                                          AS 新状态,
  c."reviewComment"                                 AS 标记
FROM Contract_fake_close_recovery_20260629 b
JOIN "Contract" c ON c.id = b.id
LEFT JOIN (
  SELECT "contractId", SUM(amount) AS paid
  FROM "Payment"
  WHERE status IN ('CONFIRMED', 'RECONCILED') AND "deletedAt" IS NULL
  GROUP BY "contractId"
) paid ON paid."contractId" = c.id
ORDER BY (c."totalAmount" - COALESCE(paid.paid, 0)) DESC;

-- =====================================================================
-- 回滚 SQL (如需回退, 跑这一段; 必须先确认 backup 表还在)
-- =====================================================================
-- BEGIN;
--   UPDATE "Contract" c
--   SET
--     status = b.status,
--     "reviewComment" = b."reviewComment",
--     "updatedById" = b.closed_by,
--     "updatedAt" = b.closed_at
--   FROM Contract_fake_close_recovery_20260629 b
--   WHERE c.id = b.id;
--
--   DELETE FROM "ContractReviewLog"
--   WHERE id LIKE 'crrl_recover_%';
-- COMMIT;