# Row-Level Security (RLS) 部署说明

## 现状

- **5 张核心表**（Customer / Contract / Project / Invoice / Payment）已配置 RLS policy
- 迁移文件：`prisma/migrations/20260609_rls/migration.sql`
- 角色：`qt_app`（应用账户，**BYPASSRLS**）+ `qitai`（超管，迁移用）

## 设计权衡

应用层 `ownershipWhere(user)` 是**主防线**（性能更好，可控可测），RLS 是**防御纵深**（即使 service 漏掉 owner 过滤，DB 也兜底）。

**生产部署推荐拆分两个 DB 用户**：

| 用户 | bypassrls | 用途 | 场景 |
|---|---|---|---|
| `qt_app_write` | true | Next.js Route Handler 写 | web 服务、API |
| `qt_app_read` | false | 统计 / 报表查询（强制 RLS） | BI、只读报表 |
| `qt_internal` | false | 后台 jobs（带 RLS context） | cron jobs |

## 当前实现

`lib/rls.ts` 提供：
- `applyRlsContext(tx, user)` — 事务开始时设置 `app.user_id` / `app.user_role`
- `bypassRlsContext(tx)` — 显式置 `bypass_rls=on`，用于 cron
- `rlsTransaction(prisma, user, fn)` — 包装事务

`createCustomer` 已用 `rlsTransaction` 包装（验证 RLS 写路径生效）。

## 验证

```sql
-- 切到 qt_app_read 角色测试
BEGIN;
SET LOCAL app.user_role = 'SALES';
SET LOCAL app.user_id = '<sales-user-id>';
SELECT count(*) FROM "Customer";  -- 应=0（sales 没建过）
COMMIT;

BEGIN;
SET LOCAL app.user_role = 'ADMIN';
SET LOCAL app.user_id = '<admin-user-id>';
SELECT count(*) FROM "Customer";  -- 应=全部
COMMIT;
```

## 完整启用 RLS（可选）

如果决定完全启用 RLS（去掉 BYPASSRLS），需要改造：
1. 把 5 个 service 的 list / get / update 全部用 `rlsTransaction` 包装
2. `requireSession` 后立刻知道 user → 注入 rlsTransaction
3. cron jobs / seed 改用 `bypassRlsContext` 包事务

工作量 ~4 小时；P3 阶段已留迁移 + helper，生产可按需启用。
