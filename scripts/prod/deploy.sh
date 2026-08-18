#!/usr/bin/env bash
# 日常更新部署 (v0.16.0+): native systemd 主路径, pg/minio/data 走 docker
# (v0.17+: qt-app 不再产 docker 镜像,无 fallback; rollback.sh 去 --docker 选项)
#
# 用法: 在 /opt/qt 目录下, sudo -E ./scripts/prod/deploy.sh
#
# 关键设计 (历史经验都浓缩在 _lib.sh 里):
#   1. self-rewrite 护栏: 把脚本+_lib.sh 复制到 /tmp 稳定副本再 exec
#      (避免 git pull 改到 deploy.sh 自身时, bash 按旧字节偏移继续读新文件)
#   2. preflight: .env 完整性 / git 干净 / 磁盘 > 3G / 内存预警 /
#      qt-app.service 已启用 (防 native 启不来)
#      (防止 v0.13.6 那种"磁盘写满"事故重演)
#   3. native build: 跳过 docker build (3.5GB 机器 docker build ~14min,
#      native 30s-2min). .next/cache 持久化 → Turbopack 增量复用;
#      npm ci 仅在 lockfile 变化时跑 (常规部署 0s).
#   4. pg / minio 仍在 docker: docker-data 卷已挂, 数据不动.
#      只 docker compose up -d postgres minio, app 不再 compose.
#   5. prisma migrate deploy / release:publish 也都走 native (不再 docker run --rm),
#      .git 直接读, MIGRATION_DATABASE_URL 从 .env 拿.
#   6. systemctl restart qt-app.service: 毫秒级, 与 docker 滚动替换等价;
#      build 期间旧进程继续服务 (只要 <PORT> 没占).
#   7. release:publish 失败不阻断部署 (跟历史行为兼容).
#   8. smoke test + cron 健康自检兜底 (防止 2025-09~2026-06 cron 静默失败 9 个月).
#
# 回滚: scripts/prod/rollback.sh (默认切上一版本; .next/cache 增量 = 秒级).
#
# 远端触发: scripts/prod/remote-deploy.sh (本地 Mac 用 QT.pem 触发, 不必手动 ssh).

# ---- self-rewrite 护栏 ----
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

# shellcheck source=/dev/null
source "${QT_DEPLOY_LIB:?QT_DEPLOY_LIB 未设置, self-rewrite 路径异常}"

require_root_or_docker

# ---- preflight ----
preflight_check

# ---- git pull ----
log "==> git pull --ff-only"
git pull --ff-only

# ---- 重新跑 preflight (pull 之后版本/branch 可能变) ----
preflight_check

# ---- 检查 native 服务可用性 (防脚本正常运行但 systemd 没启) ----
if ! systemctl cat qt-app.service >/dev/null 2>&1; then
  log_err "qt-app.service unit 不存在;首次切 native 需先 sudo cp ops/qt-app.service /etc/systemd/system/ && sudo systemctl daemon-reload && sudo systemctl enable qt-app.service"
  log_err "           (qt-app:latest 镜像已 DEPRECATED, 不再是 fallback; native systemd 是唯一运行路径)"
  exit 1
fi
if ! systemctl is-enabled --quiet qt-app.service; then
  log "==> qt-app.service 未启用;现在 enable (不会立即 start, 等 systemctl restart 时起)"
  systemctl enable qt-app.service
fi

# ---- 加载 .env, derive compose 需要的 env (pg/minio 仍在 docker) ----
set -a; . ./.env; set +a
export POSTGRES_SUPER_PASSWORD=$(echo "$MIGRATION_DATABASE_URL" | sed -E "s|.*://qitai:([^@]+)@.*|\1|")
export MINIO_ROOT_USER="$MINIO_ACCESS_KEY"
export MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY"

VERSION="v$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' package.json | head -1)"
APP_VERSION="${VERSION}+$(git rev-parse --short HEAD)"
log "==> 版本: $APP_VERSION"

# ---- native build (跳过 docker build) ----
# 三个加速点:
#   (a) .next/cache 跨部署持久 → Turbopack 增量复用, 改动小秒级
#   (b) npm ci 仅在 lockfile/patches/prisma/schema 变化时跑 → 常规部署 0s
#   (c) 没有 docker layer cache 失效, 源代码变只重编变化模块
log "==> native build (npm ci + prisma generate + next build)"
# NODE_ENV 保存移到分支外公共路径: 否则 lockfile 稳定走 else 跳过 npm ci 时
# save_NODE_ENV 未赋值, 后面 export NODE_ENV="$save_NODE_ENV" 在 set -u 下报
# unbound variable (v0.20.3 部署实测 exit 1)
save_NODE_ENV="${NODE_ENV:-}"
NEED_FULL_CI=0
if git diff --name-only HEAD@{1} HEAD -- package.json package-lock.json patches/ prisma/ 2>/dev/null | grep -q .; then
  NEED_FULL_CI=1
fi
if [ "$NEED_FULL_CI" -eq 1 ]; then
  log "  lockfile/patches/prisma 变了 → npm ci"
  # .env 里 NODE_ENV=production (供 Next 运行时用), 但 npm ci 看到 production 会自动
  # omit devDependencies → prisma / tsx / vitest 等开发工具都不装, 导致 npx prisma
  # 临时下载 prisma@x 但找不到 prisma.config.ts 依赖. 临时清掉再装.
  unset NODE_ENV
  set +e
  # npm 10 在 3.5GB 机器上 (memory 可用 ~1.3GB) 跑 npm ci 时,
  # bin 链接和 postinstall 顺序有 bug: postinstall 的 patch-package
  # 在 node_modules/.bin/patch-package symlink 建好前就跑 → exit 127
  # 修法: --ignore-scripts 先 ci, 完后手动补 bin + 跑 postinstall
  npm ci --ignore-scripts --legacy-peer-deps --no-audit --no-fund --registry=https://registry.npmmirror.com
  CI_EXIT=$?
  set -e
  if [ "$CI_EXIT" -ne 0 ]; then
    log_err "npm ci 失败 (exit=$CI_EXIT); 检查 npmmirror 或 lockfile 漂移"
    exit "$CI_EXIT"
  fi
  # 把 postinstall 里的 patch-package symlink 手动建好 + 跑 postinstall
  log "  npm ci 完,补 patch-package symlink + 跑 postinstall"
  npm install --prefer-offline --no-save patch-package --legacy-peer-deps --no-audit --no-fund --registry=https://registry.npmmirror.com >/dev/null 2>&1 || true
  if [ -x node_modules/.bin/patch-package ]; then
    npm run postinstall --silent 2>&1 | tail -3 || log_warn "  postinstall 警告 (patches 可能未应用, 不阻断)"
  else
    log_warn "  patch-package symlink 缺失,跳 postinstall (项目里没 patches/ 的话无影响)"
  fi
else
  log "  lockfile 稳定 → 跳过 npm ci (node_modules 复用)"
fi

# prisma generate 总是跑 (client 漂移修复; 跟 schema 是否变无关, 几十秒)
# 还原 NODE_ENV (后续 npx next build 与 systemd 都要 production)
export NODE_ENV="$save_NODE_ENV"
log "==> prisma generate"
npx prisma generate

# next build: 复用 .next/cache 走增量
log "==> next build (.next/cache 复用, 增量编译)"
# 把 .env 关键项透给 build (页面 force-dynamic 但仍是 source-time read)
APP_VERSION="$APP_VERSION" \
NEXT_PUBLIC_APP_VERSION="$APP_VERSION" \
SKIP_ENV_VALIDATION=1 \
NEXT_TELEMETRY_DISABLED=1 \
npx next build

# ---- 基础设施 (pg / minio 仍在 docker) ----
COMPOSE="docker compose -f docker-compose.prod.yml"
log "==> $COMPOSE up -d postgres minio"
$COMPOSE up -d postgres minio

# ---- prisma migrate deploy (native, MIGRATION_DATABASE_URL) ----
log "==> prisma migrate deploy (native, MIGRATION_DATABASE_URL)"
# 迁移必须以 MIGRATION_DATABASE_URL (qitai, DB owner) 执行:
# prisma.config.ts 的 datasource.url 默认读 DATABASE_URL (qt_app 降权账号),
# ALTER TYPE / ALTER TABLE OWNER 等 owner-only DDL 会被 42501 拒 (v0.20.3 事故:
# MessageType enum 补值报 must be owner of type)。
: "${MIGRATION_DATABASE_URL:?MIGRATION_DATABASE_URL 未设置, 无法以 owner 身份跑迁移}"
# 已知问题兜底: 20260630_message_type_enum_index 想 CREATE TYPE MessageType,
# 但 20260627_message_type_enum_bootstrap 已经预创建, fresh DB 撞 "type already exists".
set +e
DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy 2>&1 | tee /tmp/migrate.log
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
  DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --applied 20260630_message_type_enum_index
  RESOLVE_EXIT=$?
  set -e
  if [ $RESOLVE_EXIT -ne 0 ]; then
    log_warn "prisma resolve --applied 返回 $RESOLVE_EXIT (可能 migration 不在 failed 状态, 继续)"
  fi
  DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate deploy
  log_ok "fallback 成功"
else
  log_err "prisma deploy 失败但不是已知 20260630 enum 冲突, 不走 fallback"
  tail -30 /tmp/migrate.log
  exit $EXIT1
fi

# ---- release:publish (native, 直接读 .git) ----
log "==> release:publish (自动发布更新日志; 同版本已存在则幂等跳过)"
set +e
npx tsx scripts/release/publish.ts
PUBLISH_EXIT=$?
set -e
if [ "$PUBLISH_EXIT" -ne 0 ]; then
  log_warn "release:publish 失败 (exit=$PUBLISH_EXIT) — 部署继续"
  log_warn "       稍后手动补: cd /opt/qt && npx tsx scripts/release/publish.ts"
fi

# ---- seed-roles (幂等同步角色权限矩阵 → DB) ----
# 权限以 DB Role.permissions 为准 (lib/permissions.ts 运行时缓存);
# 新增资源/权限 (如 RECONCILIATION) 只改代码矩阵不同步 DB 的话, 线上全员 403。
# seed-roles 是 upsert, 每次部署跑一遍保证 DB 与代码矩阵一致。
log "==> seed-roles (同步内置角色权限到 DB, 幂等)"
set +e
npx tsx scripts/shared/seed-roles.ts
SEED_EXIT=$?
set -e
if [ "$SEED_EXIT" -ne 0 ]; then
  log_warn "seed-roles 失败 (exit=$SEED_EXIT) — 部署继续, 但新增权限可能未生效"
  log_warn "       稍后手动补: cd /opt/qt && npx tsx scripts/shared/seed-roles.ts"
fi

# ---- restart app (native) ----
# Next.js 16 + 活跃 SSE / keep-alive 连接 → SIGTERM 关闭慢; deploy.sh 容错:
#   1. 先 SIGTERM (systemctl kill --no-block) 等 up to 30s 优雅退出
#   2. 30s 内不退就 SIGKILL (next-server 进程组)
#   3. systemd start 再起新进程 (RestartSec=5 兜底)
log "==> systemctl restart qt-app.service (native build 完毕)"
systemctl kill -s SIGTERM --kill-who=main --no-block qt-app.service 2>/dev/null || true
GRACE_OK=0
for i in $(seq 1 30); do
  if ! pgrep -f "next-server" >/dev/null 2>&1; then
    GRACE_OK=1
    break
  fi
  sleep 1
done
if [ "$GRACE_OK" -ne 1 ]; then
  log_warn "next-server SIGTERM 30s 内不退 (Next 16 SSE/keep-alive bug);SIGKILL 强退"
  pkill -9 -f "next-server" 2>/dev/null || true
  sleep 1
fi
# 让 systemd 重新拉起 (Restart=on-failure 在 SIGKILL 后也会拉, 但显式 start 更可控)
systemctl start qt-app.service
# 等新进程在 3000 端口就绪 (最快 197ms, 偶尔 2s)
RESTART_OK=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -o /dev/null --max-time 1 http://127.0.0.1:3000/login 2>/dev/null; then
    RESTART_OK=1
    break
  fi
  sleep 1
done
if [ "$RESTART_OK" -ne 1 ]; then
  log_warn "qt-app 10s 内未在 3000 端口应答;看 journalctl -u qt-app -n 50"
fi

# ---- 磁盘清理 ----
# v0.17+ qt-app 已无 docker 镜像 (native); pg/minio 是 compose active 服务, 不动.
# 兜底清 dangling 中间层 (一般 0B; 偶尔 stale build 中间产物会卡)
log "==> 磁盘清理"
docker image prune -f >/dev/null || true
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
