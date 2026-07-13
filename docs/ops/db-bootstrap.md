# 数据库引导与迁移恢复

`prisma/migrations/` 下的 SQL 文件是 schema 与已部署数据库之间的合同。本文档说明：**新环境如何拉到最新 schema**、**漂移（drift）如何恢复**、**为什么不能合并迁移**。

> 配套规则见 `AGENTS.md` 的 "Database Migrations" 章节。

## 1. 新机器 / 全新数据库的引导

```bash
# 1. 准备 .env（拷贝模板，填本机/远端连接串）
cp .env.example .env

# 2. 装依赖
npm ci

# 3. 应用所有迁移到 schema 最新状态
npm run prisma:deploy

# 4. 生成 Prisma Client
npm run prisma:generate

# 5. 跑系统种子（角色/部门/字典，不可重复跑业务种子）
npm run seed
```

`prisma migrate deploy` 会按时间顺序应用 `prisma/migrations/` 下所有未应用的迁移，然后停止。**不要**用 `npm run prisma:migrate`（即 `migrate dev`），它会建 shadow 数据库从头重放，跟我们这套迁移历史不兼容（部分迁移依赖 `prisma/seed.ts` 写入的 ADMIN 角色才能跑）。

## 2. 漂移（drift）恢复

drift 的两种典型场景：

### 场景 A：本地 `prisma/migrations/` 缺文件（DB 已应用）

症状：

```text
$ npx prisma migrate status
The migrations from the database are not found locally in prisma/migrations:
  <timestamp>_<name>
  ...
```

恢复步骤：

1. 在 `git log --all -- prisma/migrations/<timestamp>_<name>/` 里找到该迁移的最后一个存在版本。
2. 用 `git show <commit>:<path>/migration.sql` 把内容恢复到 `prisma/migrations/<timestamp>_<name>/migration.sql`。
3. 跑 `npx prisma migrate status` 确认漂移消除，只剩真正待应用的新迁移。
4. 跑 `npm run prisma:deploy` 应用新迁移。

参考实例：2026-06-29 恢复 `20260615_drop_project_milestones` / `20260622_project_progress_log_soft_delete` / `20260622_drop_project_budget_and_payment_allocation` 三个迁移。

### 场景 B：本地有文件但 DB 未应用

通常是 `git pull` 之后没跑过 `prisma migrate deploy`。直接：

```bash
npm run prisma:deploy
```

## 3. 为什么不能把现有迁移合并成一个

简单说：`prisma migrations` 是**生产数据库的 schema 演进日志**，不是「如何从空库建出当前 schema」的脚本。

- 生产 DB 的 `_prisma_migrations` 表已经记录了全部 40 条历史
- 把本地 40 个文件删成 1 个 init，`migrate deploy` 会立刻报 "migration not found"
- 即便强行对齐（清空生产 `_prisma_migrations` 重新打 baseline），也会丢失「某天加过某列/某索引」的审计线索

合理做法是**只对未来的迁移做发布节奏 squash**：在 PR 合并时把同一次发布的若干 ALTER 合并成 1 个语义命名的迁移（`v0.4.0_consolidated`），但**永远不回头改旧历史**。

## 4. 重建 dev 数据库（清空后重来）

仅用于本地开发。**生产禁止**：

```bash
# 停掉应用
docker compose -f docker-compose.dev.yml down

# 删数据卷（连同 Postgres 数据）
docker volume rm qt-biz_postgres_data

# 起空库
docker compose -f docker-compose.dev.yml up -d

# 跑完整引导
npm run prisma:deploy
npm run prisma:generate
npm run seed
```

## 5. schema 快照（排查用）

出问题时想知道「schema 当前长什么样」，跑：

```bash
npm run db:snapshot
```

会在 `docs/db-schema-snapshot.sql` 写入一份按 Prisma schema 生成的完整 DDL。**这是只读参考**，不会进入 `_prisma_migrations`，跟生产 deploy 无冲突；该文件已加入 `.gitignore`，由脚本运行时生成，不进入版本控制。
