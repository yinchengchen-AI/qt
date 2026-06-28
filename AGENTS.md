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

- Conventional Commits: `feat(scope): …`, `fix(scope): …`, `chore(scope): …`, `refactor(scope): …`, `docs(scope): …`. Common scopes: `workflow`, `deploy`, `i18n`, `layout`, `payment`, `statistics`. Bodies may be in Chinese.
- One logical change per commit; squash WIP locally before pushing.
- PRs cover motivation, change summary, and validation (commands run, screenshots for UI). Link the issue or `docs/` runbook. Call out schema/migration, auth, and storage-affecting changes explicitly.
- Never commit `.env`, `docker-data/`, `backups/`, or `docs/*部署记录*.md` (see `.gitignore`).

## Security & Configuration Tips

- Copy `.env.example` to `.env`; `lib/env.ts` validates required env vars and fails fast.
- Dev defaults (`minioadmin/minioadmin`, `postgres/postgres`) are local only — rotate before any non-dev deploy.
- Uploads/downloads go through the Next.js proxy; MinIO stays on the internal `:9000` and is never exposed publicly.
- `npm run seed` is for system data only; production seeds run manually on fresh machines, not during routine updates.
