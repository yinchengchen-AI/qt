#!/usr/bin/env bash
# 数据库备份：每日 1 次，保留 30 天
# 用法：./scripts/backup.sh
set -euo pipefail

BACKUP_DIR=${BACKUP_DIR:-./backups}
DAYS_TO_KEEP=${DAYS_TO_KEEP:-30}
DB_URL=${DATABASE_URL:-postgresql://qt_app:qt_app_pass@localhost:5432/qt_biz?schema=public}

mkdir -p "$BACKUP_DIR"
TS=$(date +"%Y%m%d_%H%M%S")
FILE="$BACKUP_DIR/qt_biz_$TS.dump"

# 用 pg_dump 导出（custom format，压缩好）
# 注意：需要 PG 客户端工具；可由 alpine postgresql-client 镜像提供
DOCKER_PG=${DOCKER_PG:-qitai-postgres}

if command -v pg_dump >/dev/null 2>&1; then
  pg_dump --format=custom --no-owner --no-acl --file="$FILE" "$DB_URL"
else
  docker exec "$DOCKER_PG" pg_dump -U qitai -d qt_biz -F c -f "/tmp/qt_biz_$TS.dump"
  docker cp "$DOCKER_PG:/tmp/qt_biz_$TS.dump" "$FILE"
  docker exec "$DOCKER_PG" rm -f "/tmp/qt_biz_$TS.dump"
fi

echo "✓ 备份完成：$FILE"
ls -lh "$FILE"

# 清理 N 天前的旧备份
find "$BACKUP_DIR" -name "qt_biz_*.dump" -mtime +$DAYS_TO_KEEP -delete 2>/dev/null || true
echo "✓ 已清理 ${DAYS_TO_KEEP} 天前的旧备份"
