-- Fix: 给 qt_app 授予 DunningNote 表权限
--
-- 背景: 20260703_aging_redesign 迁移只 CREATE TABLE DunningNote (owner = qitai),
--       漏了 GRANT 给 qt_app (BYPASSRLS 用户的应用运行时用户)。
--       qt_app 即使有 BYPASSRLS 旁路 RLS, 仍需表级 GRANT 才能 SELECT/INSERT/UPDATE/DELETE。
--       部署后 aging 页报 42501 permission denied for table DunningNote。
--
-- 修复: 现场 (生产 2026-07-03) 已手动 GRANT (commit 873f49d3 同事务加),
--       此迁移给 fresh DB 兜底; 在已部署环境是幂等的 (GRANT 重复跑无副作用)。
--
-- 后续 DDL 规则: 新表必须在迁移内 GRANT 给 qt_app, 沿用此约定。

GRANT ALL ON TABLE "DunningNote" TO qt_app;
