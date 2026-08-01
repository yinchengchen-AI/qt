# Repository Guidelines

Contributor guide for **qt-biz** — Next.js 16 (App Router) + React 19 + TypeScript on Prisma 7 / PostgreSQL 16 / MinIO with antd 6 and pro-components. See `README.md` and `docs/DESIGN-v3.md` for the full design.

## Project Structure & Module Organization

- `app/(app)/<feature>/` — App Router pages per business module (admin, contracts, customers, dashboard, invoices, payments, statistics). `app/api/<feature>/` holds the route handlers; `app/login/` handles auth.
- `components/` — shared UI plus feature folders (`admin/`, `customers/`, `file/`, `form/`).
- `lib/` — `prisma.ts`, `auth.ts`, `permissions.ts`, `env.ts`, `i18n.ts`, `format.ts`, `upload-client.ts`, zustand stores, `validators/`, `types/`. `server/` adds `services/`, `jobs/`, `events/`, `storage/` for backend logic.
- `prisma/`, `tests/`, `scripts/{dev,prod,shared,migrate}/`, `ops/`, `docs/` — schema, Vitest + Playwright suites, ops scripts, systemd/cron, and design docs. `@/*` aliases to the repo root.

## Build, Test, and Development Commands

Node `>=20.9.0`. Use `npm`; `pnpm-lock.yaml` is kept in sync.

- `npm run dev:setup` then `npm run dev` — start Postgres + MinIO via `docker-compose.*.yml`, then Next.js on `http://localhost:3000`.
- `npm run build` / `npm run start` — production build and serve.
- `npm run typecheck` — `tsc --noEmit`. `npm run lint` / `lint:fix` — ESLint 9 flat config.
- `npm test` (Vitest) and `npm run test:e2e` (Playwright; auto-boots dev).
- `npm run prisma:migrate` / `prisma:generate` / `prisma:studio` for schema; `npm run seed`, `seed:dev-users`, `create-admin`, `reset-password` for system data. The `seed:dev-users` script idempotently upserts the 5 dev test accounts (admin/sales/finance/ops/expert — one per role, EXPERT is for permission tests, not on the login quick-fill card); their shared password is `DEV_QUICK_FILL_PASSWORD` (default `dev-only-fill`).

## Coding Style & Naming Conventions

- TypeScript only for new code; legacy `*.mjs` scripts may stay. `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- 2-space indent, single quotes; match the surrounding file's style.
- Server Components by default; add `"use client"` only for state, effects, or browser APIs. Prefer `lib/use-action-call.ts` and `use-list-request.ts` over ad-hoc fetch code.
- Naming: route segments kebab-case, components PascalCase, hooks `use-*.ts`, Prisma models PascalCase, env validated via `lib/env.ts`. Unused identifiers may be `_`-prefixed.

## Testing Guidelines

- Vitest for unit, lib, and API tests; Playwright for E2E.
- Filenames: `<feature>.test.ts` for Vitest, `NN-<flow>.spec.ts` for E2E (e.g. `01-admin-full-flow.spec.ts`).
- Playwright runs serially against `http://localhost:3000` across `chromium` (desktop), `ipad-portrait`, and `iphone-13`.
- For schema drops, add a regression spec — see `tests/milestones-removed.test.ts` for the pattern.

## Commit & Pull Request Guidelines

- **代码改动闭环**: 每次修改/更新代码后,先跑测试验证(`npm run typecheck` + `npm run lint` + `npm test`)通过;**先更新文档(CHANGELOG.md / README 最近更新 / 受影响的 docs/)和版本号(`npm version`),再 commit/push**,然后完成服务器部署(`scripts/prod/deploy.sh`),不要停在 commit/push。纯文档/注释类改动可不部署,随下次部署顺带上线。
- Conventional Commits: `feat(scope): …`, `fix(scope): …`, `chore(scope): …`, `refactor(scope): …`, `docs(scope): …`. Common scopes: `workflow`, `deploy`, `i18n`, `layout`, `payment`, `statistics`. Bodies may be in Chinese.
- One logical change per commit; squash WIP locally before pushing.
- PRs cover motivation, change summary, and validation (commands run, screenshots for UI). Link the issue or `docs/` runbook. Call out schema/migration, auth, and storage-affecting changes explicitly.
- Never commit `.env`, `docker-data/`, `backups/`, or `docs/*部署记录*.md` (see `.gitignore`).
- **发布版本**: 用 `npm version patch|minor|major`(自动 bump + commit + tag),不要手动改 `package.json:version` 之后忘记 tag。Commit message 风格 `chore(release): bump to vX.Y.Z`。当前 base 与 README 同步在 `0.13.8`;登录页右上 chip 由 `next.config.mjs#computeAppVersion()` 自动派生为 `<base>+<git short sha>.<MMDD>`,commit → dev/build 重启即可看到新版本号;CI 容器无 `.git` 时回落到 `NEXT_PUBLIC_APP_VERSION` env 或 `"v2.0"`。
- **更新日志全自动发布**: `scripts/prod/deploy.sh` 在镜像构建成功后自动跑 `release:publish`(一次性容器内执行 `npx tsx scripts/release/publish.ts`,`.git` 只读挂载):读 `package.json` 版本 → 取上一个 release tag 到 HEAD 的 commits(过滤 `chore(release)`/`docs(release)` 噪音)→ 幂等写入 AppRelease(`source=GIT_COMMITS`)。同版本已存在则跳过;想重新生成先在 DB 软删旧记录再重跑。发布人默认工号 `admin`,可用 env `RELEASE_PUBLISHER_EMPLOYEE_NO` 覆盖。该步失败只告警不阻断部署,可手动补跑。**手工发布入口已移除**(无 /admin/releases 页面、无写 API),API 只读(list/detail/latest/read),写入唯一路径是 publish.ts。

## Deploy Quick Reference

- **日常部署** (server 上, 在 `/opt/qt`): `sudo -E ./scripts/prod/deploy.sh` — 全程自动 (`preflight` → `git pull` → `docker build` → `migrate deploy` → `release:publish` → `compose up -d` → `smoke` → `cron 健康检查`)。日志写到 `/var/log/qt-deploy.log`。
- **本地 Mac 触发远端** (v0.13.8+): `./scripts/prod/remote-deploy.sh` — 用 `~/Downloads/QT.pem` (或 `~/.ssh/qt_deploy.pem`) ssh 进 server, 在远端 tmux 里跑 deploy.sh, 本地断线不中断 deploy。配置在 `.deploy-target` (gitignored)。
- **一键回滚** (server 上): `bash scripts/prod/rollback.sh` — 默认切到上一版; `--list` 看历史版本, `--to v0.13.6` 指定版本, `--skip-smoke` 紧急跳过 smoke。镜像保留最近 2 版 (`deploy.sh` 末尾的 `KEEP=2`)。
- **shared lib**: `scripts/prod/_lib.sh` 提供 `log / preflight_check / smoke_test / require_root_or_docker`;`deploy.sh` 和 `rollback.sh` 都通过 self-rewrite 护栏复制它到 `/tmp` 再 source。
- **详细文档**: 当前部署流程见 [docs/ops/deploy-current.md](docs/ops/deploy-current.md);历史事故档案在 `docs/ops/deploy-history/` (不读也能 deploy, 只是事故复盘)。

## Security & Configuration Tips

- Copy `.env.example` to `.env`; `lib/env.ts` validates required env vars and fails fast.
- Dev defaults (`minioadmin/minioadmin`, `postgres/postgres`) are local only — rotate before any non-dev deploy.
- Uploads/downloads go through the Next.js proxy; MinIO stays on the internal `:9000` and is never exposed publicly.
- `npm run seed` is for system data only; production seeds run manually on fresh machines, not during routine updates.

## Database Migrations

- `prisma/migrations/<committed>/` 是不可变的。**已合并到 main 的迁移文件禁止删除、重命名或重写 SQL**。代码与 `_prisma_migrations` 表共同构成生产 schema 的合同，破坏任一边都会让所有已部署环境在 `prisma migrate deploy` 报 "migration not found"。
- 删字段/删表通过新增的迁移做（`ALTER TABLE ... DROP COLUMN`），不要回滚历史迁移。
- 新环境拉代码后用 `npm run prisma:deploy` 应用迁移；不要用 `prisma migrate dev`（它会建 shadow DB 跑完整重放，跟当前迁移历史不兼容）。
- 撞上 drift（DB 已应用某迁移但本地缺文件）时参考 `docs/db-bootstrap.md` 的恢复流程，从 git 历史找回原文件，**不要** `migrate resolve` 凭空标记。
- **新表必须显式 GRANT 给 qt_app**：`qt_app` 是 BYPASSRLS 应用运行时用户（BYPASSRLS 只旁路 RLS 策略，**不**旁路表级权限）。任何 `CREATE TABLE` 迁移在末尾追加 `GRANT ALL ON TABLE "<TableName>" TO qt_app;`；漏了会报 `42501 permission denied for table <X>`（v0.7.0 真实事故：`DunningNote`）。回填用新迁移 `GRANT ... TO qt_app;`（幂等），不要改原 SQL 破坏 checksum。
