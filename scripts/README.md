# 脚本目录

按 **环境** 划分子目录: dev / prod / shared。所有脚本用 `./scripts/<env>/<script>` 调用。

```
scripts/
├── dev/          仅开发环境使用
│   ├── dev-up.sh           一键启动: 容器 + 推库 + seed + pnpm dev
│   ├── dev-down.sh         一键停止: 杀 next dev + docker compose down
│   └── loadtest.mjs        压测: 50 并发 × 5s 打 /api/customers
├── prod/         仅生产环境使用
│   ├── deploy.sh           日常更新: git pull + install + migrate + build + restart + smoke
│   ├── backup.sh           数据库备份 (dev/prod 通用, 行为差异由 env 控制)
│   └── audit-cleanup.sh    审计日志清理 (cron 跑)
└── shared/       dev / prod 都可能用到
    ├── create-admin.ts     初始化管理员: pnpm create-admin
    ├── reset-password.ts   重置任意用户密码: pnpm reset-password
    ├── seed-roles.ts       同步 system roles: pnpm seed-roles
    ├── seed-dicts.ts       同步 8 类数据字典: pnpm seed-dicts
    └── generate-divisions.cjs  重新生成 lib/china-divisions.ts: pnpm divisions
```

## 常用命令

| 用途 | 命令 |
|------|------|
| 启动 dev (一键) | `./scripts/dev/dev-up.sh` |
| 停止 dev (一键) | `./scripts/dev/dev-down.sh` |
| 压测 (dev) | `node scripts/dev/loadtest.mjs` |
| 更新生产代码 | `cd /opt/qt && sudo -E ./scripts/prod/deploy.sh` |
| 手动备份 (生产) | `sudo DOCKER_PG=qt-postgres BACKUP_DIR=/opt/qt/backups BACKUP_MIRROR_MINIO=1 /opt/qt/scripts/prod/backup.sh` |
| 清理审计日志 (生产) | `DOCKER_PG=qt-postgres /opt/qt/scripts/prod/audit-cleanup.sh 5` |
| 重置用户密码 (任一环境) | `pnpm reset-password --employeeNo <id> --password <newPwd>` |
| 创建管理员 (任一环境) | `pnpm create-admin --employeeNo admin --name ... --email ... --role ADMIN` |
| 重新生成行政区划数据 | `pnpm divisions` |

## Prisma migrate 三件套 (npm scripts)

| 用途 | 命令 | 何时用 |
|------|------|--------|
| 改 schema 时生成新 migration | `pnpm prisma:migrate` (= `prisma migrate dev`) | 本地开发 |
| 看一下当前 DB 跟 migrations 差多远 | `pnpm prisma:status` (= `prisma migrate status`) | 本地/CI drift 自检 |
| 把 migrations 应用到目标 DB,不生成新文件 | `pnpm prisma:deploy` (= `prisma migrate deploy`) | 生产部署 / CI 测试环境 |

`prisma:migrate` 会改 schema,只能本地跑;`prisma:deploy` 只 apply 不改 schema,
是 `scripts/prod/deploy.sh` 实际执行的命令(走 `MIGRATION_DATABASE_URL` 降权账号)。

## CI 漂移校验

`.github/workflows/ci.yml` 在 PR 上自动跑 `pnpm prisma:status`,
**有 unapplied migration 会直接红灯**,避免再次出现"本地能跑、线上 500"的漂移。
三件事也跑在 CI 里: lint、typecheck、vitest,都基于一次性 Postgres 16 service container。

## 脚本依赖 / 设计

- `prod/backup.sh` **同时被 dev 复用**: 行为差异由 `DOCKER_PG` / `BACKUP_DIR` / `BACKUP_MIRROR_MINIO` 控制, 不需要 `backup-prod.sh` 副本。
- `dev-up.sh` 走 `prisma migrate dev` (会改 schema), 生产部署走 `prisma migrate deploy` (只应用, 不会改 schema)。**两个命令不能混用**。
- `audit-cleanup.sh` 默认 5 年, 详见 `lib/permissions` / 设计文档 §13。
- `generate-divisions.cjs` 产出物 `lib/china-divisions.ts` 已在仓库, 平时不用跑; 区划数据调整 (比如杭州新增区) 时重跑一次, 把新文件 commit 进来。
