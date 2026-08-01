#!/usr/bin/env bash
# qt-biz 回滚 (v0.16.0+: native 主路径, docker 应急副路径)
#
# 用法:
#   bash scripts/prod/rollback.sh              # 回滚到 HEAD~1 (默认)
#   bash scripts/prod/rollback.sh --to <sha>   # 回滚到指定 commit / tag
#   bash scripts/prod/rollback.sh --list       # 列出最近 10 个回滚候选
#   bash scripts/prod/rollback.sh --docker     # 应急: 切回 docker qt-app
#   bash scripts/prod/rollback.sh --skip-smoke # 紧急回滚 (跳过 smoke test)
#
# 设计:
#   - 默认 native 回滚: git checkout <target> + 增量 next build (用 .next/cache)
#     改动小时 = 秒级, 大改 = 1-2min. 不动 DB schema (schema 永远 forward).
#   - --docker: 适用 systemd 炸了不想排查, 或本地 native 起不来.
#     用 qt-app:latest 镜像启动容器. 注意镜像必须存在 (deploy 默认保留 1 版).
#   - 备份当前 commit 到 .rollback-<sha>, 出问题可滚回.
#
# 远端触发通过 remote-deploy.sh 透传 docker 参数即可, 不另起脚本.

set -euo pipefail
cd "$(cd "$(dirname "$0")/../.." && pwd)"

LOG_PREFIX="[rollback]"
log() { printf '%s %s\n' "$LOG_PREFIX" "$*"; }
err() { printf '%s ERROR: %s\n' "$LOG_PREFIX" "$*" >&2; exit 1; }

usage() {
  cat <<USAGE
用法: bash scripts/prod/rollback.sh [--to <sha>] [--list] [--docker] [--skip-smoke]

默认 (无 flag): 回滚到 HEAD~1.
--to <sha>    : 回滚到指定 commit/tag.
--list        : 列出最近 10 个回滚候选 (commit + tag 标记).
--docker      : 应急切回 docker qt-app:latest.
--skip-smoke  : 跳过 smoke test (紧急回滚用).
USAGE
}

TARGET=""
LIST=0
DOCKER=0
SKIP_SMOKE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --to)        shift; TARGET="${1:?--to 需要 commit/tag}";;
    --list)      LIST=1;;
    --docker)    DOCKER=1;;
    --skip-smoke) SKIP_SMOKE=1;;
    --help|-h)   usage; exit 0;;
    *)           err "未知 flag: $1 (用 --help 看用法)";;
  esac
  shift
done

# ---- --list: 仅打印候选 ----
if [ "$LIST" -eq 1 ]; then
  log "最近 10 个回滚候选:"
  git log --oneline -10
  log
  log "最近 chore(release) tag:"
  git log --oneline --grep='^chore(release)' -5
  exit 0
fi

# ---- 备份当前位置 (出问题可滚回) ----
BACKUP_BRANCH=".rollback-$(git rev-parse --short HEAD)"
if ! git rev-parse --verify --quiet "$BACKUP_BRANCH" >/dev/null 2>&1; then
  git branch "$BACKUP_BRANCH" >/dev/null 2>&1 || true
  log "备份当前位置到 $BACKUP_BRANCH (滚回: git checkout $BACKUP_BRANCH)"
fi

# ---- --docker: 切回 docker ----
if [ "$DOCKER" -eq 1 ]; then
  log "应急切回 docker qt-app:latest"
  systemctl stop qt-app.service 2>/dev/null || true
  if ! docker inspect qt-app:latest >/dev/null 2>&1; then
    err "qt-app:latest 镜像不存在;先用 bash scripts/prod/deploy.sh (会重建 docker 镜像) 或 docker load"
  fi
  set -a; . ./.env; set +a
  export POSTGRES_SUPER_PASSWORD=$(echo "$MIGRATION_DATABASE_URL" | sed -E "s|.*://qitai:([^@]+)@.*|\1|")
  export MINIO_ROOT_USER="$MINIO_ACCESS_KEY"
  export MINIO_ROOT_PASSWORD="$MINIO_SECRET_KEY"
  docker compose -f docker-compose.prod.yml up -d app
  if [ "$SKIP_SMOKE" -ne 1 ]; then
    sleep 3
    code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:3000/login || echo 000)
    if [ "$code" != "200" ]; then
      err "docker smoke 失败 (HTTP $code);systemd 路径仍可用"
    fi
  fi
  log "[OK] 已切回 docker. qt-app.service 已停. 重新切 native: bash scripts/prod/switch-to-native.sh"
  exit 0
fi

# ---- native 回滚 ----
[ -z "$TARGET" ] && TARGET="HEAD~1"
log "回滚到 $TARGET"

# 解析 target (commit / tag / HEAD~N 都支持)
RESOLVED=$(git rev-parse --verify --quiet "$TARGET^{commit}" 2>/dev/null || git rev-parse --verify --quiet "$TARGET" 2>/dev/null)
if [ -z "$RESOLVED" ]; then
  err "找不到 commit/tag: $TARGET"
fi
SHORT=$(git rev-parse --short "$RESOLVED")
log "  解析到 $SHORT ($(git log -1 --format='%s' "$RESOLVED"))"

git checkout "$RESOLVED"
log "git checkout 完成"

# 仅在依赖变化时 npm ci (跟 deploy.sh 一样的判断)
NEED_CI=0
if git diff --name-only HEAD@{1} HEAD -- package.json package-lock.json patches/ 2>/dev/null | grep -q .; then
  NEED_CI=1
fi
if [ "$NEED_CI" -eq 1 ]; then
  log "lockfile/patches 变了 → npm ci"
  npm ci --legacy-peer-deps --no-audit --no-fund --registry=https://registry.npmmirror.com
else
  log "lockfile 稳定 → 跳过 npm ci"
fi

# prisma generate + 增量 build (用 .next/cache)
log "==> prisma generate + next build (增量, .next/cache 复用)"
APP_VERSION="v$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' package.json | head -1)+$SHORT" \
NEXT_PUBLIC_APP_VERSION="$SHORT" \
SKIP_ENV_VALIDATION=1 \
NEXT_TELEMETRY_DISABLED=1 \
bash -c '
  set -e
  npx prisma generate
  npx next build
'

log "==> systemctl restart qt-app"
systemctl restart qt-app.service
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS -o /dev/null --max-time 1 http://127.0.0.1:3000/login 2>/dev/null; then break; fi
  sleep 1
done

if [ "$SKIP_SMOKE" -ne 1 ]; then
  log "==> smoke test"
  for spec in "login=200" "dashboard=307" "api/customers=401"; do
    path="${spec%=*}"; want="${spec#*=}"
    got=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:3000/${path}" || echo 000)
    got=${got:-000}
    if [ "$got" = "$want" ]; then
      log "  ${path}: ${got} OK"
    else
      err "  ${path}: ${got} (期望 ${want}) — 回滚 smoke 失败. 滚回原 commit: bash scripts/prod/rollback.sh --to $BACKUP_BRANCH"
    fi
  done
fi

log "[OK] 回滚完成 → $SHORT"
log "    滚回原 commit: bash scripts/prod/rollback.sh --to $BACKUP_BRANCH"
