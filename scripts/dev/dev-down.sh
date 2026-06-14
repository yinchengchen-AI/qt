#!/usr/bin/env bash
# 开发环境一键停止: kill next dev + 停 PG/MinIO 容器
# 用法: ./scripts/dev/dev-down.sh
# 数据卷保留 (./docker-data/), 下次 dev-up 不用重灌
set -euo pipefail
cd "$(dirname "$0")/../.."

red()   { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
say()   { printf "\033[36m==> %s\033[0m\n" "$*"; }

# --- 1) kill next dev (找 .next-pid.txt 或 fallback pkill) ---
say "停止 next dev"
if [ -f .next-pid.txt ]; then
  PID=$(cat .next-pid.txt)
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" && green "  killed pid $PID"
  fi
  rm -f .next-pid.txt
else
  pkill -f "next dev" 2>/dev/null && green "  pkill next dev" || green "  next dev 不在跑"
fi

# --- 2) 停容器 (保留数据卷) ---
say "停 MinIO 容器"
docker compose -f docker-compose.minio.yml down
say "停 PG 容器"
docker compose -f docker-compose.postgres.yml down

green "dev-down 完成, 数据卷 (./docker-data/) 已保留"
