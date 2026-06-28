#!/usr/bin/env bash
# 日常更新部署: git pull + install + migrate + build + restart + smoke
# 用法: 在 /opt/qt 目录下, sudo -E ./scripts/prod/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "==> git pull"
git pull --ff-only

echo "==> pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

echo "==> source .env (for DATABASE_URL / MIGRATION_DATABASE_URL)"
set -a; . ./.env; set +a
echo "==> prisma migrate deploy (用 MIGRATION_DATABASE_URL 走降权账号,只 apply 不改 schema)"

DATABASE_URL="$MIGRATION_DATABASE_URL" npm run prisma:deploy

echo "==> prisma generate (sync client to current schema; postinstall only runs patch-package)"
npx --no-install prisma generate

# 3.5GB RAM 的小内存机器上, 默认 V8 堆 + 多 worker 构建会 OOM Killed.
# 显式收紧堆大小并把 worker 数收敛到 1, 稳定可复现.
# 大内存机器 (>=8GB) 可以用 BUILD_WORKERS=$(nproc) 走多 worker 加速构建.
# 调度 telemetry: 关闭 Next.js 上报, 与构建内存无关, 借本脚本一并设上, 保持幂等.
BUILD_WORKERS="${BUILD_WORKERS:-1}"
NODE_MAX_OLD_SPACE="${NODE_MAX_OLD_SPACE:-2048}"

echo "==> pnpm build (BUILD_WORKERS=$BUILD_WORKERS, NODE_MAX_OLD_SPACE=${NODE_MAX_OLD_SPACE}MB)"
NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE}" \
  NEXT_TELEMETRY_DISABLED=1 \
  NEXT_BUILD_WORKERS="$BUILD_WORKERS" \
  pnpm build
# 生产日常更新不再 seed: roles/dicts/depts/workflow templates 已在首次部署时落地,
# 重复跑 pnpm seed 会 (1) 浪费时间 (9 份 workflow template × 5 阶段 × N 任务 = 几百次 DB 写),
# (2) 即使 idempotent, 也有微弱的角色权限/部门字段被 update 覆盖风险。
# 新机器/灾备恢复/重置环境部署时, 手动跑: cd /opt/qt && pnpm seed

echo "==> systemctl restart qt-app"
systemctl restart qt-app

echo "==> smoke test (waiting 3s for app boot)"
sleep 3
curl -fsS -o /dev/null -w "  login  : %{http_code}\n" http://127.0.0.1:3000/login
curl -fsS -o /dev/null -w "  dashboard: %{http_code} (expect 307)\n" http://127.0.0.1:3000/dashboard
curl -sS -o /dev/null -w "  api/customers: %{http_code} (expect 401)\n" http://127.0.0.1:3000/api/customers
echo "==> crond self-check (RHEL: crond, Debian: cron)"
if systemctl is-active --quiet crond 2>/dev/null; then
  echo "  crond: active"
elif systemctl is-active --quiet cron 2>/dev/null; then
  echo "  cron:  active"
else
  echo "[ERR] neither crond nor cron is active" >&2
  systemctl list-units --type=service --all 2>/dev/null | grep -iE 'cron|anacron' >&2 || true
  exit 1
fi

echo "[OK] deploy done"
