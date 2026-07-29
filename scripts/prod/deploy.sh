#!/usr/bin/env bash
# 日常更新部署(Docker 版): git pull + docker build + migrate + release:publish + compose up + smoke
# 用法: 在 /opt/qt 目录下, sudo -E ./scripts/prod/deploy.sh
#
# v0.13.2 起应用(qt-app)也容器化:
#   - 镜像在服务器本地构建 (Dockerfile 多阶段, standalone 产物)
#   - qt-app 用 host 网络, .env 里的 127.0.0.1 地址 (PG/MinIO) 零改动可用
#   - migrate deploy / release:publish 用 docker run --rm 一次性容器执行
#   - 宿主机 nginx 不动, 上游仍是 127.0.0.1:3000; native systemd qt-app 已退役
#   - 回滚: docker tag qt-app:<旧版本> qt-app:latest && docker compose -f docker-compose.prod.yml up -d app

# 自我改写护栏 (2026-07-29 v0.13.2 部署实证): 本脚本第 1 步就是 git pull,
# 若 deploy.sh 自身在 pull 中被更新, bash 会按旧字节偏移继续读新文件,
# 静默跳过/错乱后续步骤 (本次新插入的 release:publish 段被整段跳过)。
# 因此在做任何事之前, 先把脚本复制到临时文件并 re-exec 该稳定副本。
# 注意: re-exec 后 $0 指向 /tmp 副本, 仓库根目录必须先解析成绝对路径传过去。
if [ -z "${QT_DEPLOY_REEXEC:-}" ]; then
  export QT_DEPLOY_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  STABLE_COPY="$(mktemp /tmp/qt-deploy.XXXXXX.sh)"
  cp "$0" "$STABLE_COPY"
  export QT_DEPLOY_REEXEC=1
  exec bash "$STABLE_COPY" "$@"
fi

set -euo pipefail
cd "${QT_DEPLOY_ROOT:?QT_DEPLOY_ROOT 未设置, 请勿直接 source 本脚本}"

COMPOSE="docker compose -f docker-compose.prod.yml"

echo "==> git pull"
git pull --ff-only

echo "==> source .env (for DATABASE_URL / MIGRATION_DATABASE_URL / MINIO_*)"
set -a; . ./.env; set +a
# compose 里 postgres/minio 服务需要的变量
export POSTGRES_SUPER_PASSWORD=$(echo "$MIGRATION_DATABASE_URL" | sed -E "s|.*://qitai:([^@]+)@.*|\1|")
export MINIO_ROOT_USER="$MINIO_ACCESS_KEY"
export MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY"

VERSION="v$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
APP_VERSION="${VERSION}+$(git rev-parse --short HEAD)"
echo "==> 版本: $APP_VERSION"

# 内存兜底 (2026-07-08 v0.9.7 / 2026-07-18 v0.10.3 / 2026-07-29 v0.13.4 部署教训):
# 3.5GB 机器上 Turbopack 编译 RSS 可超 2GB, docker build 与 native build 内存需求相同。
# 策略: 首选零停机构建 (qt-app/PG/MinIO 全部在线, 缓存命中时内存压力小);
# 仅在构建被 OOM (exit=137) 时才停容器重试一次 — v0.13.4 之前是无条件停 qt-app,
# 每次部署都有整个 build 时长 (~3-4 min) 的停机, 得不偿失。
# 只动 qt 自己的容器; mysql-fineui 属其它项目, 不自动停。
STOPPED_CONTAINERS=""
stop_for_build() {
  if [ "$(docker inspect -f '{{.State.Running}}' qt-app 2>/dev/null)" = "true" ]; then
    echo "==> OOM 重试: 停止 qt-app 容器腾内存 (~340MB)"
    docker stop qt-app >/dev/null
    STOPPED_CONTAINERS="qt-app"
  fi
  AVAIL_MEM_MB=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
  if [ "${AVAIL_MEM_MB:-0}" -gt 0 ] && [ "$AVAIL_MEM_MB" -lt 2200 ]; then
    for c in qt-postgres qt-minio; do
      if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
        echo "==> OOM 重试: MemAvailable=${AVAIL_MEM_MB}MB < 2200MB, 临时停止 $c"
        docker stop "$c" >/dev/null
        STOPPED_CONTAINERS="$STOPPED_CONTAINERS $c"
      fi
    done
  fi
}
restart_stopped() {
  if [ -n "$STOPPED_CONTAINERS" ]; then
    echo "==> 拉起临时停止的容器:$STOPPED_CONTAINERS"
    # shellcheck disable=SC2086 -- 需要按空格拆成多个参数
    docker start $STOPPED_CONTAINERS >/dev/null
  fi
}

echo "==> docker build qt-app:${VERSION} (APP_VERSION=${APP_VERSION}, 零停机首选)"
set +e
NEXT_TELEMETRY_DISABLED=1 docker build \
  --build-arg APP_VERSION="$APP_VERSION" \
  -t "qt-app:${VERSION}" \
  -t qt-app:latest \
  .
BUILD_EXIT=$?
set -e
if [ "$BUILD_EXIT" -eq 137 ] && command -v docker >/dev/null 2>&1; then
  echo "::warning::构建被 OOM Kill (exit=137), 停容器后重试一次"
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
  echo "[ERR] docker build 失败 (exit=$BUILD_EXIT)" >&2
  if [ "$BUILD_EXIT" -eq 137 ]; then
    echo "      exit=137 = OOM Kill; 内存仍不足可手动 docker stop mysql-fineui (其它项目, 356MB) 后重跑" >&2
  fi
  exit "$BUILD_EXIT"
fi

echo "==> 确保基础设施容器在跑 (postgres / minio)"
$COMPOSE up -d postgres minio

echo "==> prisma migrate deploy (一次性容器, 用 MIGRATION_DATABASE_URL 走降权账号)"
run_migrate() {
  docker run --rm --network host --env-file .env \
    -e DATABASE_URL="$MIGRATION_DATABASE_URL" \
    qt-app:latest npx prisma migrate deploy
}
# 已知问题兜底: 20260630_message_type_enum_index 想 CREATE TYPE MessageType,
# 但 20260627_message_type_enum_bootstrap 已经预创建了 (含全部 12 个值),
# 在 fresh DB 上按时间序 deploy 会撞 "type already exists".
# 检测到该 migration 失败时, 手工修 schema + resolve --applied 跳过, 然后再 deploy 一次.
set +e
run_migrate 2>&1 | tee /tmp/migrate.log
EXIT1=${PIPESTATUS[0]}
set -e
if [ $EXIT1 -eq 0 ]; then
  echo "==> prisma deploy 一次过, 无需 fallback"
elif grep -q "20260630_message_type_enum_index" /tmp/migrate.log; then
  echo "::warning::20260630_message_type_enum_index 撞 MessageType already exists, 走 enum fallback"
  ADMIN_URL="${DATABASE_URL:-}"
  if [ -z "$ADMIN_URL" ]; then
    echo "[ERR] 20260630 enum fallback 需要 DATABASE_URL (admin 角色), 但 .env 里没设"
    exit 1
  fi
  # .env 里的 DATABASE_URL 含 ?schema=public, psql 不认, 去掉
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
    echo "::warning::prisma resolve --applied 返回 $RESOLVE_EXIT (可能 migration 不在 failed 状态, 继续)"
  fi
  run_migrate
  echo "==> fallback 成功"
else
  echo "[ERR] prisma deploy 失败但不是已知 20260630 enum 冲突, 不走 fallback"
  tail -30 /tmp/migrate.log
  exit $EXIT1
fi

echo "==> release:publish (自动发布更新日志; 同版本已存在则幂等跳过)"
# 失败只告警不阻断: 发布日志失败不应拖垮发版, 可稍后手动补:
#   cd /opt/qt && docker run --rm --network host --env-file .env -v /opt/qt/.git:/app/.git:ro qt-app:latest npx tsx scripts/release/publish.ts
# 注: .git 只读挂载进容器, git log 只读历史不写 worktree; package.json 用镜像内的(与 pull 后的 commit 一致)
set +e
docker run --rm --network host --env-file .env \
  -v "$QT_DEPLOY_ROOT/.git:/app/.git:ro" \
  qt-app:latest npx tsx scripts/release/publish.ts
PUBLISH_EXIT=$?
set -e
if [ "$PUBLISH_EXIT" -ne 0 ]; then
  echo "[WARN] release:publish 失败 (exit=$PUBLISH_EXIT) — 部署继续;" >&2
  echo "       稍后手动补: cd /opt/qt && docker run --rm --network host --env-file .env qt-app:latest tsx scripts/release/publish.ts" >&2
fi

echo "==> docker compose up -d app (滚动替换 qt-app 容器)"
$COMPOSE up -d app

echo "==> 清理悬空镜像 (保留最近 3 个 qt-app 版本 tag)"
docker image prune -f >/dev/null
KEEP=3
# shellcheck disable=SC2012
for tag in $(docker images qt-app --format '{{.Tag}}' | grep '^v' | sort -rV | tail -n +$((KEEP + 1))); do
  docker rmi "qt-app:$tag" >/dev/null 2>&1 || true
done

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

echo "==> cron 健康检查 (防止 2025-09~2026-06 cron 静默失败 9 个月的重演)"
# 1) 验证 /etc/cron.d/qt-jobs 是最新版本 (source .env 必须有)
if ! grep -q "set -a && . /opt/qt/.env" /etc/cron.d/qt-jobs 2>/dev/null; then
  echo "[ERR] /etc/cron.d/qt-jobs 漏 source .env — CRON_SECRET 在 crond 环境里会空, API 返回 401"
  echo "      修法: sudo cp ops/qt-jobs.cron /etc/cron.d/qt-jobs && sudo chmod 644 /etc/cron.d/qt-jobs && sudo systemctl restart cron"
  exit 1
fi
echo "  /etc/cron.d/qt-jobs: ✓ 含 source .env"

# 2) 立即触发一次 run-all, 验证 token / API 通畅 (不阻塞 deploy, 仅记录)
RUN_ALL_CODE=$(curl -fsS -o /tmp/run-all-test.json -w "%{http_code}" -X POST -H "Authorization: Bearer ${CRON_SECRET}" http://127.0.0.1:3000/api/jobs/run-all 2>/dev/null || echo "000")
if [[ "$RUN_ALL_CODE" == "200" ]]; then
  SCANNED=$(grep -oP '"scanned":\d+' /tmp/run-all-test.json 2>/dev/null | wc -l)
  echo "  run-all 自检: ✓ HTTP 200 (扫了 $SCANNED 个 job)"
  rm -f /tmp/run-all-test.json
elif [[ "$RUN_ALL_CODE" == "401" ]]; then
  echo "[ERR] run-all 自检: ✗ HTTP 401 — CRON_SECRET 不匹配!"
  echo "      检查 .env 里 CRON_SECRET 跟 /etc/cron.d/qt-jobs 里的 \$CRON_SECRET 是否一致"
  exit 1
else
  echo "[WARN] run-all 自检: HTTP $RUN_ALL_CODE (跳过, 等下次 cron 跑验证)"
fi

# 3) 跑一次 cron-healthcheck.sh (验证自检脚本本身能跑)
if [[ -x /opt/qt/scripts/ops/cron-healthcheck.sh ]]; then
  if /opt/qt/scripts/ops/cron-healthcheck.sh --once >> /var/log/qt-cron.log 2>&1; then
    echo "  cron-healthcheck: ✓"
  else
    echo "[WARN] cron-healthcheck 自检有异常 — 看 /var/log/qt-cron.log"
  fi
else
  echo "  cron-healthcheck: ⚠ 脚本不存在 (/opt/qt/scripts/ops/cron-healthcheck.sh), 跳过"
fi

echo "[OK] deploy done"
