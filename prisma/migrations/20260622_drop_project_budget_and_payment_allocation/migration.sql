-- 项目管理移除"预算"字段 + 回款管理移除"分配明细"功能
--
-- 背景:
--   - 项目预算 (Project.budgetAmount) 跟合同总额/客户预算重叠, 落地后跟实际项目执行脱节,
--     反而干扰项目回归纯业务 (服务范围/起止/负责人 才是核心). 历史回款里已存的 budgetAmount
--     全部 drop (无 FK 引用, 无需迁移).
--   - 回款分配明细 (PaymentAllocation) 是一张独立的明细表, 把"一笔回款"拆给"多张发票/多个项目",
--     实际业务回款 = "按合同挂的" 一笔对一笔, 拆分配反而引入跨合同抹账风险 (P1-5 校验就是为它加的).
--     去掉后 Payment.invoiceId 仍然保留, 一笔回款 → 一张发票的关系足够.
--
-- 行为:
--   - DROP COLUMN Project.budgetAmount (无索引, 无 FK 引用, 直接 drop)
--   - DROP TABLE PaymentAllocation CASCADE (连带 drop FK 约束; 历史行直接清掉, 不归档)
--   - 注意 ON DELETE RESTRICT 在 PaymentAllocation.paymentId 上, CASCADE 必带才能 drop

BEGIN;

ALTER TABLE "Project" DROP COLUMN "budgetAmount";

DROP TABLE IF EXISTS "PaymentAllocation" CASCADE;

COMMIT;
