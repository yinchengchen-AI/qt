#!/usr/bin/env bash
# 数据库备份 + (可选) MinIO 镜像。dev / 生产统一用这一份。
#
# 用法:
#   ./scripts/backup.sh                            # 本地 (默认 qitai-postgres, ./backups)
#   DOCKER_PG=qt-postgres BACKUP_DIR=/opt/qt/backups \
#     BACKUP_MIRROR_MINIO=1 ./scripts/backup.sh     # 生产
#
# 行为差异由 env var 控制,不需要再单独维护 backup-prod.sh。
#   DATABASE_URL         PG 连接串 (用于取 DB_NAME)
#   MIGRATION_DATABASE_URL 超级用户连接串 (取 DB_USER + PGPASSWORD,用于 pg_dump,
#                         避免 app 账号 (qt_app) 锁不到 migration 留下的备份表)
#   DOCKER_PG            容器名 (默认 qitai-postgres,生产 cron 覆盖为 qt-postgres)
#   BACKUP_DIR           本地备份目录 (默认 ./backups,生产建议 /opt/qt/backups)
#   DAYS_TO_KEEP         本地/远端保留天数 (默认 30)
#   BACKUP_MIRROR_MINIO  1 = 强制镜像到 MinIO; 0 = 强制跳过; auto = 自动检测
#   MINIO_BACKUP_BUCKET  MinIO 桶名 (默认 qt-backups)
#   MINIO_ALIAS          MinIO alias 名 (默认 local)
#   MINIO_ENDPOINT       MinIO 端点 (默认 http://127.0.0.1:9000)
#
# 输出可重定向给 cron,所以保留 echo 时间戳行;不要 echo 到 stderr。
set -euo pipefail

# --- 配置 ---
BACKUP_DIR=${BACKUP_DIR:-./backups}
DAYS_TO_KEEP=${DAYS_TO_KEEP:-30}
DOCKER_PG=${DOCKER_PG:-qitai-postgres}
DB_URL=${DATABASE_URL:-postgresql://qitai:qitai_pass@localhost:5432/qt_biz?schema=public}
DB_NAME=$(echo "$DB_URL" | sed -E 's|.*/([^?]+)(\?.*)?$|\1|')
# 优先用 MIGRATION_DATABASE_URL 的超级用户做 dump, 避免应用账号 (qt_app) 锁不到
# migration 留下的 _*_bak / _prisma_migrations 等表。生产环境 MIGRATION_DATABASE_URL
# 指向 PG 超级用户 (qitai), 而 DATABASE_URL 是 BYPASSRLS 的 app 账号 (qt_app)。
MIGRATION_URL=${MIGRATION_DATABASE_URL:-$DATABASE_URL}
DB_USER=$(echo "$MIGRATION_URL" | sed -E 's|.*://([^:]+):.*|\1|')
SUPER_PW=$(echo "$MIGRATION_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')

MINIO_BACKUP_BUCKET=${MINIO_BACKUP_BUCKET:-qt-backups}
MINIO_ALIAS=${MINIO_ALIAS:-local}
MINIO_ENDPOINT=${MINIO_ENDPOINT:-http://127.0.0.1:9000}
MC=${MC:-/usr/local/bin/mc}
PG_RESTORE=${PG_RESTORE:-pg_restore}

# --- 自动检测是否镜像 MinIO ---
if [ "${BACKUP_MIRROR_MINIO:-auto}" = "auto" ]; then
  if [ -x "$MC" ] && [ -n "${MINIO_ACCESS_KEY:-}" ] && [ -n "${MINIO_SECRET_KEY:-}" ]; then
    BACKUP_MIRROR_MINIO=1
  else
    BACKUP_MIRROR_MINIO=0
  fi
fi

mkdir -p "$BACKUP_DIR"
TS=$(date +"%Y%m%d_%H%M%S")
FILE="$BACKUP_DIR/${DB_NAME}_$TS.dump"

# --- 1) pg_dump (服务器端 PG 16,走容器内二进制) ---
echo "[$(date +%FT%T)] pg_dump ($DOCKER_PG, $DB_NAME) -> $FILE"
docker exec -e PGPASSWORD="$SUPER_PW" "$DOCKER_PG" \
  pg_dump --format=custom --no-owner --no-acl --schema=public -U "$DB_USER" -d "$DB_NAME" \
  > "$FILE"
echo "  -> $(du -h "$FILE" | cut -f1)"

# --- 2) 完整性校验 (走容器内 pg_restore 16,避免 host 客户端版本太老读不动) ---
echo "[$(date +%FT%T)] pg_restore --list (integrity check, via $DOCKER_PG)"
if docker exec "$DOCKER_PG" pg_restore --list "$FILE" >/dev/null 2>&1; then
  ENTRIES=$(docker exec "$DOCKER_PG" pg_restore --list "$FILE" 2>/dev/null | wc -l | tr -d ' ')
  echo "  -> OK ($ENTRIES entries)"
else
  # 不让单次校验失败炸掉整个备份 (dump 仍然可用,只是没做校验)
  echo "  -> WARN: integrity check failed,但 dump 文件已落地,继续后续 MinIO 镜像" >&2
fi

# --- 3) MinIO 镜像 (可选) ---
if [ "$BACKUP_MIRROR_MINIO" = "1" ]; then
  echo "[$(date +%FT%T)] mc cp -> $MINIO_ALIAS/$MINIO_BACKUP_BUCKET"
  "$MC" --quiet alias set "$MINIO_ALIAS" "$MINIO_ENDPOINT" "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY" >/dev/null
  "$MC" --quiet mb --ignore-existing "$MINIO_ALIAS/$MINIO_BACKUP_BUCKET" >/dev/null
  "$MC" cp "$FILE" "$MINIO_ALIAS/$MINIO_BACKUP_BUCKET/$(basename "$FILE")"
else
  echo "  (skip MinIO mirror: BACKUP_MIRROR_MINIO=$BACKUP_MIRROR_MINIO)"
fi

# --- 4) 清理 N 天前的旧备份 ---
echo "[$(date +%FT%T)] cleanup > ${DAYS_TO_KEEP}d"
find "$BACKUP_DIR" -name "${DB_NAME}_*.dump" -mtime +"$DAYS_TO_KEEP" -delete 2>/dev/null || true
if [ "$BACKUP_MIRROR_MINIO" = "1" ]; then
  "$MC" rm --recursive --force --older-than "${DAYS_TO_KEEP}d" \
    "$MINIO_ALIAS/$MINIO_BACKUP_BUCKET/" 2>/dev/null || true
fi
echo "[OK] backup done: $FILE"
