# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**qt-biz** is an internal business management system for 杭州企泰安全科技. It manages customers, contracts, invoices, payments, and employee profiles, with attachments stored in MinIO.

- **Framework**: Next.js 16 (App Router, RSC, Server Actions), React 19
- **Language**: TypeScript 6 with `strict` + `noUncheckedIndexedAccess`
- **UI**: Ant Design 6 + @ant-design/pro-components
- **ORM/DB**: Prisma 7 + PostgreSQL 16
- **Auth**: NextAuth v4 (Credentials + JWT)
- **State**: zustand + swr
- **Storage**: MinIO via AWS SDK v3 presigned URLs
- **Tests**: Vitest (unit + API), Playwright (e2e)

Node `>=20.9.0` is required. Use `npm`; `pnpm-lock.yaml` is kept in sync.

## Common Commands

### Development

```bash
# One-shot setup: start Postgres + MinIO, install deps, run migrations, seed
npm run dev:setup

# Start dev server (requires .env and running Postgres/MinIO)
npm run dev

# Stop local infrastructure
npm run dev:down
```

### Build & Type Check

```bash
npm run build
npm run typecheck        # tsc --noEmit
```

### Lint

```bash
npm run lint
npm run lint:fix
```

Lint uses ESLint 9 flat config (`eslint.config.js`). Several react-hooks rules are intentionally disabled because the project uses many experimental hooks rules that conflict with the current code style.

### Tests

```bash
# Run all Vitest tests (unit + API)
npm test

# Run a single test file
npx vitest run tests/api/contract-create-validation.test.ts

# Watch mode
npx vitest

# E2E (Playwright; auto-starts dev server)
npm run test:e2e

# Run a single e2e spec
npx playwright test tests/e2e/05-invoice-payment-flow.spec.ts
```

### Database

```bash
# Generate Prisma client
npm run prisma:generate

# Create/apply migration in dev
npm run prisma:migrate

# Apply migrations in production/staging
npm run prisma:deploy

# Open Prisma Studio
npm run prisma:studio
```

### Seeding & Admin

```bash
npm run seed                    # System data: roles, departments, dictionaries
npm run seed:dev-users          # 5 dev test accounts (admin/sales/finance/ops/expert)
npm run create-admin -- \
  --employeeNo admin \
  --name "系统管理员" \
  --email admin@example.com \
  --password 'Your-Strong-Pwd-2026'
npm run reset-password -- --employeeNo admin --password 'New-Pass'
```

Dev test account passwords come from `DEV_QUICK_FILL_PASSWORD` (default `dev-only-fill`).

## Architecture

### Layered Code Organization

The codebase follows a layered Next.js App Router structure:

- **`app/(app)/`** — Authenticated pages grouped by business module (customers, contracts, invoices, payments, statistics, admin, reports).
- **`app/api/`** — Route Handlers for external HTTP APIs (CRUD, exports, files, jobs, auth).
- **`app/login/`** — Unauthenticated login page.
- **`components/`** — Shared UI components plus feature folders.
- **`lib/`** — Client-side utilities: auth, permissions, validators, hooks, formatting, i18n helpers.
- **`server/`** — Backend-only logic: services, jobs, events bus, storage, audit.
- **`prisma/`** — Schema, migrations, seeds.
- **`tests/`** — Vitest tests (`tests/api/`, `tests/unit/`) and Playwright specs (`tests/e2e/`).
- **`scripts/`** — Dev, prod, migration, and shared CLI scripts.

`@/*` aliases map to the repo root.

### Server-Side Patterns

Most business logic lives in **`server/services/`** rather than directly in route handlers. Route handlers are thin wrappers that:

1. Call `requireSession()` and `requirePermission()`.
2. Validate input with Zod schemas from `lib/validators/`.
3. Delegate to service functions, passing the current user.
4. Return standardized JSON or file streams.

Services generally accept `prisma` or a transaction client `tx` so they can be composed inside transactions. Use `lib/status-machine.ts` for state transitions; it supports atomic `UPDATE ... WHERE status IN (...)` to prevent race conditions.

### Authentication & Authorization

- NextAuth v4 with Credentials provider and JWT strategy (no PrismaAdapter).
- Session maxAge is 7 days if "remember me" is checked, otherwise 8 hours. This is implemented via a custom `jwt.encode` in `lib/auth.ts`.
- `lib/auth.ts` also caches active-user lookups for 5 seconds.
- Roles are hardcoded: `ADMIN`, `SALES`, `FINANCE`, `OPS`, `EXPERT`.
- Permissions are defined in `lib/permissions.ts` as a resource × action × role matrix.
- `SALES` and `EXPERT` have row-level isolation: use `ownershipWhere(user)` or `buildOwnershipWhere(user)` from `lib/ownership.ts` when querying customers/contracts/invoices/payments.

### State Machines

Core business entities have explicit state machines:

- **Contract**: `DRAFT → ACTIVE → CLOSED`. Auto-transitions via cron jobs: `contract-auto-publish`, `contract-auto-complete`, `contract-stale-notify`.
- **Invoice**: `DRAFT → PENDING_FINANCE → ISSUED → VOIDED | RED_FLUSHED`.
- **Payment**: `PLANNED → CONFIRMED → RECONCILED → REFUNDED | CANCELLED`.

Business invariants (e.g., cumulative invoice amount ≤ contract total, payment amount ≤ invoice amount) are enforced inside service transactions, not at the DB level.

### Domain Events & Jobs

- `server/events/bus.ts` emits domain events as in-app messages (`Message` table). It is the only writer to `Message`.
- `server/jobs/runner.ts` is the cron entry point triggered by `POST /api/jobs/run-all` (Vercel Cron at 01:00 UTC, or local cron).
- Jobs include contract-expiring reminders, invoice-overdue reminders, auto-publish/complete, stale-contract notifications, and certificate-expiry checks.

### File Storage

Attachments use presigned URLs to upload/download directly from MinIO:

- `POST /api/files/presign-upload` returns a PUT URL.
- Browser uploads directly to MinIO.
- `POST /api/files/[id]/presign-download` returns a GET URL.
- `app/api/files/raw/[id]/route.ts` proxies downloads for inline preview.

Object keys follow `contracts/{yyyy}/{mm}/{cuid}-{slug}.{ext}`. Soft delete removes the DB record but leaves the MinIO object.

### Audit Logging

`server/audit.ts` writes to `OperationLog` inside transactions. Request context (IP, UA, requestId, method, path) is injected via `lib/request-context.ts` / `runWithRequestContext()`. Sensitive fields are redacted automatically.

## Critical Conventions

- **Server Components by default**. Add `"use client"` only for state, effects, or browser APIs.
- **TypeScript strict** is enabled. Avoid `@ts-ignore`; prefer narrowing or safe defaults.
- **Use existing data-fetching hooks** (`lib/use-list-request.ts`, `lib/use-action-call.ts`) instead of ad-hoc `fetch` in client components.
- **Money calculations** use `Prisma.Decimal` or the helpers in `lib/money.ts`; never plain `number` arithmetic for business totals.
- **Date handling** uses `dayjs` consistently; `lib/date-range.ts` has shared range helpers.

## Database Migration Rules

From `AGENTS.md` — these are project-level hard rules:

- **Committed migrations are immutable**. Never delete, rename, or rewrite SQL files under `prisma/migrations/<committed>/`.
- Drop columns/tables via **new** migrations (`ALTER TABLE ... DROP COLUMN`), not by editing old migrations.
- New environments use `npm run prisma:deploy`, not `prisma migrate dev`.
- On drift, recover original migration files from git history; do **not** use `prisma resolve` to invent applied migrations.
- **Every `CREATE TABLE` migration must end with `GRANT ALL ON TABLE "<TableName>" TO qt_app;`**. The runtime user `qt_app` is `BYPASSRLS` but still needs table-level permissions. Missing grants cause runtime `42501 permission denied` errors.

## Environment Variables

Copy `.env.example` to `.env`. Key variables:

- `DATABASE_URL`
- `NEXTAUTH_SECRET` (≥32 chars)
- `NEXTAUTH_URL`
- `APP_ENC_KEY_HEX` (64 hex chars for AES-256-GCM)
- `APP_PUBLIC_URL`
- `CRON_SECRET` (≥16 chars, required in production)
- `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`
- `DEV_QUICK_FILL_PASSWORD`

`lib/env.ts` validates required values at startup and fails fast in production if placeholder secrets remain.

## Versioning

Use `npm version patch|minor|major` to bump. Do not manually edit `package.json:version` and forget to tag. The login page version chip is derived automatically by `next.config.mjs#computeAppVersion()` as `<package version>+<git short sha>.<MMDD>`.

## Security Notes

- Never commit `.env`, `docker-data/`, `backups/`, or `docs/*部署记录*.md`.
- MinIO should stay on the internal `:9000` port; uploads/downloads go through the Next.js proxy.
- `npm run seed` is for system data only; production seeds run manually on fresh machines.
- `FORCE_HTTPS=true` enables secure cookies in production; leave it unset when running behind an HTTP reverse proxy.

## Useful References

- `README.md` — full project documentation, changelog, and deployment notes.
- `AGENTS.md` — contributor guidelines, commit conventions, and migration rules.
- `docs/DESIGN-v3.md` — detailed design spec.
- `docs/USER_MANUAL.md` — user-facing manual.
