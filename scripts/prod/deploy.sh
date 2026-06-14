#!/usr/bin/env bash
# 日常更新部署: git pull + install + migrate + build + restart + smoke
# 用法: 在 /opt/qt 目录下, sudo -E ./scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> git pull"
git pull --ff-only

echo "==> pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

echo "==> source .env (for DATABASE_URL / MIGRATION_DATABASE_URL)"
set -a; . ./.env; set +a
echo "==> prisma migrate deploy (with MIGRATION_DATABASE_URL)"

DATABASE_URL="$MIGRATION_DATABASE_URL" npx --no-install prisma migrate deploy

echo "==> prisma generate (sync client to current schema; postinstall only runs patch-package)"
npx --no-install prisma generate

echo "==> pnpm build"
pnpm build

echo "==> pnpm seed (idempotent: workflow templates lock-if-in-use; 业务数据不 seed)"
pnpm seed

echo "==> systemctl restart qt-app"
systemctl restart qt-app

echo "==> smoke test (waiting 3s for app boot)"
sleep 3
curl -fsS -o /dev/null -w "  login  : %{http_code}\n" http://127.0.0.1:3000/login
curl -fsS -o /dev/null -w "  dashboard: %{http_code} (expect 307)\n" http://127.0.0.1:3000/dashboard
curl -fsS -o /dev/null -w "  api/customers: %{http_code} (expect 401)\n" http://127.0.0.1:3000/api/customers
echo "[OK] deploy done"
