-- 新建合同保存草稿报 500 (Prisma P2002 contractNo) 的修复.
--
-- 背景: Contract.contractNo 在 schema 上是全局 @unique, 但 service 层
-- (server/services/contract.ts:createContract) 唯一性预校验只查
-- `deletedAt: null` 的活动行, 软删后的合同仍占据唯一索引, 用户重新录
-- 同样的编号就会被 DB 直接 P2002, 路由 catch 后变成 500.
--
-- 期望: 软删的合同不再阻塞同号重新创建 (re-use 合同号是常见业务诉求,
-- 比如误删后立刻重录). 活动合同之间的唯一性仍然要保证, 走部分唯一索引
-- 表达: `WHERE "deletedAt" IS NULL`.
--
-- BEGIN/COMMIT 包裹: 单 PG 实例上两条 DDL 都是 auto-commit, 实际不构成
-- 危险窗口; 但包成事务对未来的逻辑复制 / 蓝绿 / 多分片迁移更安全,
-- 至少保证 DROP 和 CREATE 要么一起成功要么一起回滚.

BEGIN;

DROP INDEX IF EXISTS "Contract_contractNo_key";

CREATE UNIQUE INDEX "Contract_contractNo_active_key"
  ON "Contract" ("contractNo")
  WHERE "deletedAt" IS NULL;

COMMIT;
