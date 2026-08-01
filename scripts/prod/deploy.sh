#!/usr/bin/env bash
# 日常更新部署(Docker 版): preflight + git pull + docker build + migrate + release:publish + compose up + smoke
#
# 用法: 在 /opt/qt 目录下, sudo -E ./scripts/prod/deploy.sh
#
# 关键设计 (历史经验都浓缩在 _lib.sh 里):
#   1. self-rewrite 护栏: 把脚本+_lib.sh 复制到 /tmp 稳定副本再 exec
#      (避免 git pull 改到 deploy.sh 自身时, bash 按旧字节偏移继续读新文件)
#   2. preflight: .env 完整性 / git 干净 / 磁盘 > 3G / 内存预警 / 容器健康
#      (防止 v0.13.6 那种"磁盘写满"事故重演)
#   3. OOM 兜底: 仅在被 kill (exit=137) 时才停 qt-app/PG/MinIO 重试
#      (v0.13.4 之前每次部署都停 qt-app, 3-4min 停机得不偿失)
#   4. release:publish 失败不阻断部署, 仅告警 (跟历史行为兼容)
#   5. smoke test + cron 健康自检兜底 (防止 2025-09~2026-06 cron 静默失败 9 个月的重演)
#
# 回滚: scripts/prod/rollback.sh (列 qt-app:v* tags, 一键切回上一版)
#
# 远端触发: scripts/prod/remote-deploy.sh (本地 Mac 用 QT.pem 触发, 不必手动 ssh)

# ---- self-rewrite 护栏 ----
# 把 deploy.sh 和 _lib.sh 都复制到 /tmp 稳定副本, 后续在副本上执行。
# 这样即便 git pull 把 deploy.sh 改了, 我们也跑的是 pull 之前的稳定副本。
if [ -z "${QT_DEPLOY_REEXEC:-}" ]; then
  export QT_DEPLOY_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  STABLE_DIR="$(mktemp -d /tmp/qt-deploy.XXXXXX)"
  cp "$0" "$STABLE_DIR/deploy.sh"
  cp "${QT_DEPLOY_ROOT}/scripts/prod/_lib.sh" "$STABLE_DIR/_lib.sh" 2>/dev/null || \
    cp "$(dirname "$0")/_lib.sh" "$STABLE_DIR/_lib.sh"
  export QT_DEPLOY_REEXEC=1
  export QT_DEPLOY_LIB="$STABLE_DIR/_lib.sh"
  exec bash "$STABLE_DIR/deploy.sh" "$@"
fi

set -euo pipefail
cd "${QT_DEPLOY_ROOT:?QT_DEPLOY_ROOT 未设置, 请勿直接 source 本脚本}"

# 加载公共函数
# shellcheck source=/dev/null
source "${QT_DEPLOY_LIB:?QT_DEPLOY_LIB 未设置, self-rewrite 路径异常}"

require_root_or_docker

COMPOSE="docker compose -f docker-compose.prod.yml"

# ---- preflight: 任何写操作前先检查 .env / 磁盘 / 内存 / 容器 ----
preflight_check

# ---- git pull ----
log "==> git pull --ff-only"
git pull --ff-only

# ---- 重新跑 preflight (pull 之后版本/branch 可能变) ----
preflight_check

# ---- 加载 .env, derive compose 需要的 env ----
set -a; . ./.env; set +a
export POSTGRES_SUPER_PASSWORD=$(echo "$MIGRATION_DATABASE_URL" | sed -E "s|.*://qitai:([^@]+)@.*|\1|")
export MINIO_ROOT_USER="$MINIO_ACCESS_KEY"
export MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY"

VERSION="v$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
APP_VERSION="${VERSION}+$(git rev-parse --short HEAD)"
log "==> 版本: $APP_VERSION"

# ---- OOM 兜底 ----
# 3.5GB 机器上 Turbopack 编译 RSS 可超 2GB。首选零停机(缓存命中时内存压力小);
# 仅在被 OOM (exit=137) 时才停 qt-app 容器重试, 严重不足再停 qt-postgres/qt-minio。
STOPPED_CONTAINERS=""
stop_for_build() {
  if [ "$(docker inspect -f '{{.State.Running}}' qt-app 2>/dev/null)" = "true" ]; then
    log "==> OOM 重试: 停止 qt-app 容器腾内存 (~340MB)"
    docker stop qt-app >/dev/null
    STOPPED_CONTAINERS="qt-app"
  fi
  AVAIL_MEM_MB=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
  if [ "${AVAIL_MEM_MB:-0}" -gt 0 ] && [ "$AVAIL_MEM_MB" -lt 2200 ]; then
    for c in qt-postgres qt-minio; do
      if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
        log "==> OOM 重试: MemAvailable=${AVAIL_MEM_MB}MB < 2200MB, 临时停止 $c"
        docker stop "$c" >/dev/null
        STOPPED_CONTAINERS="$STOPPED_CONTAINERS $c"
      fi
    done
  fi
}
restart_stopped() {
  if [ -n "$STOPPED_CONTAINERS" ]; then
    log "==> 拉起临时停止的容器:$STOPPED_CONTAINERS"
    # shellcheck disable=SC2086 -- 需要按空格拆成多个参数
    docker start $STOPPED_CONTAINERS >/dev/null
  fi
}

# ---- docker build ----
log "==> docker build qt-app:${VERSION} (APP_VERSION=${APP_VERSION}, 零停机首选)"
set +e
NEXT_TELEMETRY_DISABLED=1 docker build \
  --build-arg APP_VERSION="$APP_VERSION" \
  -t "qt-app:${VERSION}" \
  -t qt-app:latest \
  .
BUILD_EXIT=$?
set -e
if [ "$BUILD_EXIT" -eq 137 ] && command -v docker >/dev/null 2>&1; then
  log_warn "构建被 OOM Kill (exit=137), 停容器后重试一次"
  stop_for_build
  set +e
  NEXT_TELEMETRY_DISABLED=1 docker build \
    --build-arg APP_VERSION="$APP_VERSION" \
    -t "qt-app:${VERSION}" \
    -t qt-app:latest \
    .
  BUILD_EXIT=$?
  set -e
fi
restart_stopped
if [ "$BUILD_EXIT" -ne 0 ]; then
  log_err "docker build 失败 (exit=$BUILD_EXIT)"
  if [ "$BUILD_EXIT" -eq 137 ]; then
    log_err "exit=137 = OOM Kill; 内存仍不足可手动 docker stop mysql-fineui (其它项目, 356MB) 后重跑"
  fi
  exit "$BUILD_EXIT"
fi

# ---- 基础设施 ----
log "==> docker compose up -d postgres minio"
$COMPOSE up -d postgres minio

# ---- prisma migrate deploy ----
log "==> prisma migrate deploy (一次性容器, 用 MIGRATION_DATABASE_URL 走降权账号)"
run_migrate() {
  docker run --rm --network host --env-file .env \
    -e DATABASE_URL="$MIGRATION_DATABASE_URL" \
    qt-app:latest npx prisma migrate deploy
}
# 已知问题兜底: 20260630_message_type_enum_index 想 CREATE TYPE MessageType,
# 但 20260627_message_type_enum_bootstrap 已经预创建了 (含全部 12 个值),
# 在 fresh DB 上按时间序 deploy 会撞 "type already exists".
set +e
run_migrate 2>&1 | tee /tmp/migrate.log
EXIT1=${PIPESTATUS[0]}
set -e
if [ $EXIT1 -eq 0 ]; then
  log_ok "prisma deploy 一次过, 无需 fallback"
elif grep -q "20260630_message_type_enum_index" /tmp/migrate.log; then
  log_warn "20260630_message_type_enum_index 撞 MessageType already exists, 走 enum fallback"
  ADMIN_URL="${DATABASE_URL:-}"
  if [ -z "$ADMIN_URL" ]; then
    log_err "20260630 enum fallback 需要 DATABASE_URL (admin 角色), 但 .env 里没设"
    exit 1
  fi
  PGURL=$(echo "$ADMIN_URL" | sed 's/?schema=public//')
  PGPASSWORD="${ADMIN_PGPASSWORD:-}" psql "$PGURL" -v ON_ERROR_STOP=1 \
    -c 'ALTER TABLE "Message" ALTER COLUMN "type" TYPE "MessageType" USING "type"::"MessageType";' \
    -c 'DROP INDEX IF EXISTS "Message_type_idx";' \
    -c 'CREATE INDEX "Message_type_receiverUserId_createdAt_idx" ON "Message"("type", "receiverUserId", "createdAt");'
  set +e
  docker run --rm --network host --env-file .env \
    -e DATABASE_URL="$MIGRATION_DATABASE_URL" \
    qt-app:latest npx prisma migrate resolve --applied 20260630_message_type_enum_index
  RESOLVE_EXIT=$?
  set -e
  if [ $RESOLVE_EXIT -ne 0 ]; then
    log_warn "prisma resolve --applied 返回 $RESOLVE_EXIT (可能 migration 不在 failed 状态, 继续)"
  fi
  run_migrate
  log_ok "fallback 成功"
else
  log_err "prisma deploy 失败但不是已知 20260630 enum 冲突, 不走 fallback"
  tail -30 /tmp/migrate.log
  exit $EXIT1
fi

# ---- release:publish ----
log "==> release:publish (自动发布更新日志; 同版本已存在则幂等跳过)"
set +e
docker run --rm --network host --env-file .env \
  -v "$QT_DEPLOY_ROOT/.git:/app/.git:ro" \
  qt-app:latest npx tsx scripts/release/publish.ts
PUBLISH_EXIT=$?
set -e
if [ "$PUBLISH_EXIT" -ne 0 ]; then
  log_warn "release:publish 失败 (exit=$PUBLISH_EXIT) — 部署继续"
  log_warn "       稍后手动补: cd /opt/qt && docker run --rm --network host --env-file .env -v /opt/qt/.git:/app/.git:ro qt-app:latest npx tsx scripts/release/publish.ts"
fi

# ---- compose up (滚动替换) ----
log "==> docker compose up -d app (滚动替换 qt-app 容器)"
$COMPOSE up -d app

# ---- 磁盘清理 (v0.13.6 教训: build cache 累计 15.8GB 把 49G 盘写满) ----
log "==> 磁盘清理"
docker image prune -f >/dev/null
KEEP=2
# shellcheck disable=SC2012
for tag in $(docker images qt-app --format '{{.Tag}}' | grep '^v' | sort -rV | tail -n +$((KEEP + 1))); do
  docker rmi "qt-app:$tag" >/dev/null 2>&1 || true
done
docker builder prune -f --keep-storage 4GB >/dev/null 2>&1 || true

# ---- smoke test ----
smoke_test || {
  log_err "smoke test 失败;立即回滚: bash scripts/prod/rollback.sh"
  exit 1
}

# ---- cron 健康检查 ----
log "==> cron 健康检查"
if ! grep -q "set -a && . /opt/qt/.env" /etc/cron.d/qt-jobs 2>/dev/null; then
  log_err "/etc/cron.d/qt-jobs 漏 source .env — CRON_SECRET 在 crond 环境里会空, API 返回 401"
  log_err "      修法: sudo cp ops/qt-jobs.cron /etc/cron.d/qt-jobs && sudo chmod 644 /etc/cron.d/qt-jobs && sudo systemctl restart cron"
  exit 1
fi
log_ok "  /etc/cron.d/qt-jobs: 含 source .env"

RUN_ALL_CODE=$(curl -fsS -o /tmp/run-all-test.json -w "%{http_code}" -X POST -H "Authorization: Bearer ${CRON_SECRET}" http://127.0.0.1:3000/api/jobs/run-all 2>/dev/null || echo "000")
if [[ "$RUN_ALL_CODE" == "200" ]]; then
  SCANNED=$(grep -oP '"scanned":\d+' /tmp/run-all-test.json 2>/dev/null | wc -l)
  log_ok "  run-all 自检: HTTP 200 (扫了 $SCANNED 个 job)"
  rm -f /tmp/run-all-test.json
elif [[ "$RUN_ALL_CODE" == "401" ]]; then
  log_err "run-all 自检: HTTP 401 — CRON_SECRET 不匹配!"
  log_err "      检查 .env 里 CRON_SECRET 跟 /etc/cron.d/qt-jobs 里的 \$CRON_SECRET 是否一致"
  exit 1
else
  log_warn "run-all 自检: HTTP $RUN_ALL_CODE (跳过, 等下次 cron 跑验证)"
fi

if [[ -x /opt/qt/scripts/ops/cron-healthcheck.sh ]]; then
  if /opt/qt/scripts/ops/cron-healthcheck.sh --once >> /var/log/qt-cron.log 2>&1; then
    log_ok "  cron-healthcheck: 通过"
  else
    log_warn "cron-healthcheck 自检有异常 — 看 /var/log/qt-cron.log"
  fi
else
  log_warn "  cron-healthcheck: 脚本不存在 (/opt/qt/scripts/ops/cron-healthcheck.sh), 跳过"
fi

log_ok "[OK] deploy done"
