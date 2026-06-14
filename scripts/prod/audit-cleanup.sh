#!/usr/bin/env bash
# 审计清理：删除 N 年前的 OperationLog（设计 §13 默认保留 5 年）
# 用法：./scripts/audit-cleanup.sh [YEARS=5]
set -euo pipefail

YEARS=${1:-5}
CUTOFF=$(date -u -v -${YEARS}y +"%Y-%m-%d" 2>/dev/null || date -u -d "${YEARS} years ago" +"%Y-%m-%d")
DOCKER_PG=${DOCKER_PG:-qitai-postgres}

echo "将删除 at < $CUTOFF 的 OperationLog 记录"
docker exec "$DOCKER_PG" psql -U qitai -d qt_biz -c "DELETE FROM \"OperationLog\" WHERE at < '$CUTOFF';"
