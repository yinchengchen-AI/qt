-- 下线报表中心:删除 ReportDefinition / ReportSnapshot 两张表
-- 注意:历史上 20260707_report_center 已经 CREATE 过这两张表,
-- 本 migration 只 DROP,不 CREATE,避免 fresh DB 上迁移冲突。
DROP TABLE IF EXISTS "ReportSnapshot" CASCADE;
DROP TABLE IF EXISTS "ReportDefinition" CASCADE;
