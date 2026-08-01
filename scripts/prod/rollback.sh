#!/usr/bin/env bash
# scripts/prod/rollback.sh — 一键回滚 qt-app 镜像到上一版本
#
# 设计动机:
#   - deploy.sh 注释里写"回滚: docker tag qt-app:<旧版本> qt-app:latest && ...", 但没脚本
#   - 紧急回滚时容易输错 tag (qt-app:v0.13.5 vs 0.13.5), 浪费时间
#   - 不做 smoke test 直接切会带病上线
#
# 设计:
#   1. 列出所有 qt-app:v* tag, 按 semver 倒序
#   2. 默认回滚到"上一个"版本 (latest 不算, latest 指向当前)
#   3. 支持 --to <tag> 指定版本; --list 只列不切
#   4. 切完跑 smoke test, 失败自动回滚到切之前的状态
#
# 用法:
#   bash scripts/prod/rollback.sh                   # 回滚到上一版
#   bash scripts/prod/rollback.sh --list            # 只列可用版本
#   bash scripts/prod/rollback.sh --to v0.13.6       # 指定版本
#   bash scripts/prod/rollback.sh --to v0.13.6 --skip-smoke  # 紧急回滚不跑 smoke

set -euo pipefail

# ---- self-rewrite 护栏 (跟 deploy.sh 同款) ----
if [ -z "${QT_DEPLOY_REEXEC:-}" ]; then
  export QT_DEPLOY_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  STABLE_DIR="$(mktemp -d /tmp/qt-deploy.XXXXXX)"
  cp "$0" "$STABLE_DIR/rollback.sh"
  cp "${QT_DEPLOY_ROOT}/scripts/prod/_lib.sh" "$STABLE_DIR/_lib.sh" 2>/dev/null || \
    cp "$(dirname "$0")/_lib.sh" "$STABLE_DIR/_lib.sh"
  export QT_DEPLOY_REEXEC=1
  export QT_DEPLOY_LIB="$STABLE_DIR/_lib.sh"
  exec bash "$STABLE_DIR/rollback.sh" "$@"
fi

# shellcheck source=/dev/null
source "${QT_DEPLOY_LIB:?QT_DEPLOY_LIB 未设置, self-rewrite 路径异常}"

require_root_or_docker
cd "${QT_DEPLOY_ROOT:?QT_DEPLOY_ROOT 未设置, 请勿直接 source 本脚本}"

LIST_ONLY=0
SKIP_SMOKE=0
TARGET_TAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --list) LIST_ONLY=1; shift;;
    --to) TARGET_TAG="${2:-}"; shift 2;;
    --skip-smoke) SKIP_SMOKE=1; shift;;
    -h|--help)
      sed -n '2,30p' "$0"; exit 0;;
    *) log_err "未知参数: $1"; exit 2;;
  esac
done

# ---- 列可用版本 ----
# shellcheck disable=SC2012
ALL_TAGS=$(docker images qt-app --format '{{.Repository}}:{{.Tag}}' | grep ':v' | sort -rV)
if [ -z "$ALL_TAGS" ]; then
  log_err "本地没有任何 qt-app:v* 镜像;无法回滚"
  log_err "      修法: 镜像至少保留 2 个版本 (deploy.sh 默认 KEEP=2)"
  exit 1
fi

# 当前 latest 指向哪个版本
CURRENT_TAG=$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' qt-app:latest 2>/dev/null || \
              docker inspect -f '{{.Config.Image}}' qt-app:latest 2>/dev/null | sed 's/.*://' | sed 's/^/v/')
# 上面的 inspect 拿不到我们注入的 version label, 改用 tag 反查:
CURRENT_TAG=$(docker images qt-app --format '{{.Tag}}' | grep '^v' | head -1 | sed 's/^/v/' || true)

# fallback: latest 镜像的 digest 对比
if [ -z "$CURRENT_TAG" ]; then
  CURRENT_TAG="v$(docker inspect qt-app:latest -f '{{.Id}}' 2>/dev/null | head -c 12)"
fi

log "==> 当前 latest 指向: $CURRENT_TAG"
log "==> 本地可用版本 (按版本号倒序):"
echo "$ALL_TAGS" | sed 's/^/    /'

if [ "$LIST_ONLY" -eq 1 ]; then
  exit 0
fi

# ---- 选定目标 ----
if [ -z "$TARGET_TAG" ]; then
  # 默认: 切到"上一个"版本
  # shellcheck disable=SC2012
  PREV_TAG=$(docker images qt-app --format '{{.Tag}}' | grep '^v' | sort -rV | awk 'NR==2')
  if [ -z "$PREV_TAG" ]; then
    log_err "本地只有 1 个版本,无法回滚到上一个"
    exit 1
  fi
  TARGET_TAG="v${PREV_TAG#v}"
  log "==> 未指定 --to, 默认回滚到上一版: $TARGET_TAG"
fi

# 验证 target 存在
if ! echo "$ALL_TAGS" | grep -q ":${TARGET_TAG}$"; then
  log_err "目标版本 $TARGET_TAG 不在本地镜像里"
  log_err "      修法: bash scripts/prod/rollback.sh --list 看可用版本"
  exit 1
fi

if [ "$TARGET_TAG" = "$CURRENT_TAG" ]; then
  log_warn "目标版本 $TARGET_TAG 就是当前 latest,无需回滚"
  exit 0
fi

# ---- 记录"切之前"的 latest 指向, smoke 失败时回滚 ----
SAVED_TAG="$CURRENT_TAG"

log "==> 切回 qt-app:latest -> qt-app:$TARGET_TAG"
docker tag "qt-app:$TARGET_TAG" qt-app:latest

log "==> docker compose up -d app (滚动替换)"
docker compose -f docker-compose.prod.yml up -d app

# ---- smoke test (默认跑) ----
if [ "$SKIP_SMOKE" -eq 0 ]; then
  if ! smoke_test; then
    log_err "smoke test 失败;立刻回滚到 $SAVED_TAG"
    docker tag "qt-app:${SAVED_TAG#v}" qt-app:latest 2>/dev/null || \
      docker tag "qt-app:$SAVED_TAG" qt-app:latest
    docker compose -f docker-compose.prod.yml up -d app
    exit 1
  fi
fi

log_ok "[OK] rollback to $TARGET_TAG done"
