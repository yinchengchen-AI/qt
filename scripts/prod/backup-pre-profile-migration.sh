#!/usr/bin/env bash
# 员工档案重构前全量备份。失败即退出,不能跳过。
# 用途: scripts/prod/backup-pre-profile-migration.sh
# 备份位置: backups/profile-migration-YYYY-MM-DD-HHMMSS/
#
# 与通用 backup.sh 的差异:
#   1. 仅 PG dump,不镜像 MinIO (附件不会动,跳过省时间)
#   2. 输出目录固定为 backups/profile-migration-<TS>/,不在 $BACKUP_DIR 通配
#   3. 总是用 MIGRATION_DATABASE_URL 的超级用户 (没有就退回 DATABASE_URL);
#      沿用 backup.sh 的 fallback 模式,避免 dev 缺 MIGRATION_DATABASE_URL 时 crash.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

if [ -f .env ]; then
  set -a; . .env; set +a
fi

: "${DATABASE_URL:?DATABASE_URL 未设置}"

# 沿用 backup.sh 的策略: 优先超级用户, dev 没 MIGRATION_DATABASE_URL 时回退
MIGRATION_URL=${MIGRATION_DATABASE_URL:-$DATABASE_URL}
DB_USER=$(echo "$MIGRATION_URL" | sed -E 's|.*://([^:]+):.*|\1|')
SUPER_PW=$(echo "$MIGRATION_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')
DB_HOST=$(echo "$MIGRATION_URL" | sed -E 's|.*@([^:/]+).*|\1|')
DB_PORT=$(echo "$MIGRATION_URL" | sed -E 's|.*@[^:/]+:([0-9]+).*|\1|')
DB_NAME=$(echo "$MIGRATION_URL" | sed -E 's|.*/([^?]+)(\?.*)?$|\1|')
DOCKER_PG=${DOCKER_PG:-qitai-postgres}

TS=$(date +%Y-%m-%d-%H%M%S)
BACKUP_DIR="backups/profile-migration-${TS}"
mkdir -p "$BACKUP_DIR"

echo "[backup] pg_dump → $BACKUP_DIR/profile.sql"
echo "[backup]   url  = $MIGRATION_URL"
echo "[backup]   user = $DB_USER  host = $DB_HOST:$DB_PORT  db = $DB_NAME"

# 优先容器内 pg_dump (版本对齐 + 无须本机装 psql 客户端);
# 若容器不存在,回退成本机 PGPASSWORD 直连.
if docker ps --format '{{.Names}}' | grep -qx "$DOCKER_PG"; then
  docker exec -e PGPASSWORD="$SUPER_PW" "$DOCKER_PG" \
    pg_dump -U "$DB_USER" -h localhost --clean --if-exists --no-owner --no-privileges \
    "$DB_NAME" > "$BACKUP_DIR/profile.sql"
else
  PGPASSWORD="$SUPER_PW" pg_dump \
    -U "$DB_USER" -h "$DB_HOST" -p "$DB_PORT" --clean --if-exists --no-owner --no-privileges \
    "$DB_NAME" > "$BACKUP_DIR/profile.sql"
fi

# 校验 dump 非空 + 含 EmployeeProfile 表
if [ ! -s "$BACKUP_DIR/profile.sql" ]; then
  echo "[backup] ERROR: dump 为空" >&2
  exit 1
fi
if ! grep -q "EmployeeProfile" "$BACKUP_DIR/profile.sql"; then
  echo "[backup] ERROR: dump 缺 EmployeeProfile 表,可能 dump 失败" >&2
  exit 1
fi

DUMP_SIZE=$(du -h "$BACKUP_DIR/profile.sql" | cut -f1)
echo "[backup] 完成: $BACKUP_DIR/profile.sql ($DUMP_SIZE)"
echo "$BACKUP_DIR" > "$BACKUP_DIR/PATH.txt"
ls -lh "$BACKUP_DIR"
