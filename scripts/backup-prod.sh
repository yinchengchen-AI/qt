#!/usr/bin/env bash
# 生产数据库每日备份 (本地 dump + MinIO qt-backups 桶镜像)
# cron 跑: 0 3 * * * /opt/qt/scripts/backup-prod.sh >> /var/log/qt-cron.log 2>&1
set -euo pipefail
set -a; . /opt/qt/.env; set +a

BACKUP_DIR=${BACKUP_DIR:-/opt/qt/backups}
DAYS_TO_KEEP=${DAYS_TO_KEEP:-30}
TS=$(date +"%Y%m%d_%H%M%S")
LOCAL_FILE="$BACKUP_DIR/qt_biz_$TS.dump"
mkdir -p "$BACKUP_DIR"

echo "[$(date +%FT%T)] pg_dump"
pg_dump --format=custom --no-owner --no-acl --file="$LOCAL_FILE" "$MIGRATION_DATABASE_URL"
echo "  -> $LOCAL_FILE ($(du -h "$LOCAL_FILE" | cut -f1))"

MC=/usr/local/bin/mc
if [ -x "$MC" ]; then
  echo "[$(date +%FT%T)] mc cp -> local/qt-backups"
  "$MC" alias set local http://127.0.0.1:9000 "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
  "$MC" mb --ignore-existing local/qt-backups >/dev/null
  "$MC" cp "$LOCAL_FILE" "local/qt-backups/$(basename "$LOCAL_FILE")"
else
  echo "  WARN: $MC not found, skip MinIO upload"
fi

echo "[$(date +%FT%T)] cleanup > ${DAYS_TO_KEEP}d"
find "$BACKUP_DIR" -name "qt_biz_*.dump" -mtime +$DAYS_TO_KEEP -delete 2>/dev/null || true
if [ -x "$MC" ]; then
  "$MC" rm --recursive --force --older-than "${DAYS_TO_KEEP}d" local/qt-backups/ 2>/dev/null || true
fi
echo "[OK] backup done"
