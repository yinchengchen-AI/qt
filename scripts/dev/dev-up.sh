#!/usr/bin/env bash
# 开发环境一键启动: 依赖容器 + 推库 + 启动 next dev + 烟测
# 用法: ./scripts/dev/dev-up.sh
# 停止: ./scripts/dev/dev-down.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

PG_COMPOSE=docker-compose.postgres.yml
MINIO_COMPOSE=docker-compose.minio.yml
PG_CONTAINER=qitai-postgres
MINIO_CONTAINER=qitai-minio
HOST=${HOST:-127.0.0.1}
PORT=${PORT:-3000}

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
say()   { printf "\033[36m==> %s\033[0m\n" "$*"; }

# --- 0) .env 检查 ---
if [ ! -f .env ]; then
  red ".env 不存在, 复制 .env.example"
  cp .env.example .env
  green "已生成 .env (dev 默认 minioadmin/minioadmin, qitai/qitai_pass)"
fi

# --- 1) 起 PG ---
say "起 PG 容器 ($PG_CONTAINER)"
docker compose -f "$PG_COMPOSE" up -d
say "等待 PG healthy"
for i in $(seq 1 30); do
  if docker exec "$PG_CONTAINER" pg_isready -U qitai -d qt_biz >/dev/null 2>&1; then
    green "  PG ready (${i}s)"; break
  fi
  sleep 1
  [ "$i" = "30" ] && { red "PG 30s 内未就绪"; exit 1; }
done

# --- 2) 起 MinIO ---
say "起 MinIO 容器 ($MINIO_CONTAINER)"
docker compose -f "$MINIO_COMPOSE" up -d
say "等待 MinIO healthy"
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:9000/minio/health/ready" >/dev/null 2>&1; then
    green "  MinIO ready (${i}s)"; break
  fi
  sleep 1
  [ "$i" = "30" ] && { red "MinIO 30s 内未就绪"; exit 1; }
done

# --- 3) pnpm 依赖 ---
if [ ! -d node_modules ]; then
  say "安装依赖 (pnpm install)"
  pnpm install
fi

# --- 4) 推库 + seed ---
say "prisma migrate dev"
pnpm prisma:migrate
say "prisma generate (postinstall 只跑 patch-package, 显式跑一次保险)"
pnpm prisma:generate
say "pnpm seed (系统字典/角色/管理员 幂等)"
pnpm seed
say "pnpm seed:dev-users (admin/sales/finance/ops 4 个测试账号, 密码读 DEV_QUICK_FILL_PASSWORD)"
pnpm seed:dev-users

# --- 5) 烟测预检 ---
say "烟测: dev server 起来后访问 /login /dashboard /api/customers"
say "启动 pnpm dev (前台, Ctrl-C 退出; 关停请用 ./scripts/dev/dev-down.sh)"
exec pnpm dev
