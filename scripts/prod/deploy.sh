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

# 兼容迁移合并(squash): 如果 migrations 目录里只有 20260614_init,
# 且 DB 的 _prisma_migrations 表里还登记着任一旧名字(20260609_*/20260610_*/.../20260614_align_workflow_role),
# 说明服务器 DB 终态已经等于 squash 后的 SQL,只需要把新名字登记成"已应用",跳过执行。
OLD_NAMES=(
  20260609_init 20260609_rls
  20260610_departments 20260610_drop_invoice_project_id
  20260611_add_customer_town 20260611_attachments 20260611_invoice_attachments
  20260611_remove_credit_add_contact 20260611_remove_customer_level
  20260612_workflow_engine 20260612_workflow_unique_fix
  20260613_drop_progress_log_percent 20260613_drop_project_milestones
  20260614_align_workflow_role
)
if [ -d prisma/migrations/20260614_init ] && [ ! -d prisma/migrations/20260609_init ]; then
  OLD_FOUND=$(DATABASE_URL="$MIGRATION_DATABASE_URL" npx --no-install prisma migrate status 2>&1 \
    | grep -E "$(printf '%s|' "${OLD_NAMES[@]}" | sed 's/|$//')" || true)
  if [ -n "$OLD_FOUND" ]; then
    echo "==> 检测到迁移合并(migration squash),标记 20260614_init 为已应用,跳过 SQL 执行"
    DATABASE_URL="$MIGRATION_DATABASE_URL" npx --no-install prisma migrate resolve --applied 20260614_init
  fi
fi

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
