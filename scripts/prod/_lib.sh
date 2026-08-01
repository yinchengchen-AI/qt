#!/usr/bin/env bash
# scripts/prod/_lib.sh - deploy/rollback 脚本共用的助手函数
#
# 设计目标:
#   - 单一来源: 日志格式、preflight 阈值、smoke test 等只在一处维护
#   - 兼容 bash 3.2+/4+/5+; macOS 默认 3.2, Linux 通常 5+
#   - 失败时给出可操作的修复提示(不止报错)
#
# 使用方式:
#   source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"
#   preflight_check
#   smoke_test
#
# 与 deploy.sh / rollback.sh 的约定:
#   - deploy.sh / rollback.sh 都先 re-exec 到 /tmp 稳定副本再 source 本文件
#     (避免 self-rewrite 时 $0 漂移 / 函数定义丢失)
#   - 本文件本身不在 self-rewrite 范围内(deploy.sh 改的是自己, 不改 _lib.sh)

set -o pipefail

# ---- 颜色 (无 TTY 时自动关闭, 避免污染日志) ----
if [ -t 1 ]; then
  _RED='\033[0;31m'; _YEL='\033[1;33m'; _GRN='\033[0;32m'; _DIM='\033[2m'; _NC='\033[0m'
else
  _RED=''; _YEL=''; _GRN=''; _DIM=''; _NC=''
fi

# ---- 时间戳 (秒级精度, 避免毫秒在某些 awk 下报错) ----
_ts() { date +%FT%T%z 2>/dev/null || date "+%Y-%m-%dT%H:%M:%S%z"; }

# ---- 日志 ----
# 写到 stdout (彩色) + 持久化到 ${DEPLOY_LOG:-/var/log/qt-deploy.log}
# DEPLOY_LOG=: 可以关闭持久化(测试时用)
_log_write() {
  local level="$1"; shift
  local colored_msg="$*"
  local plain_msg
  plain_msg=$(printf '%s' "$colored_msg" | sed -E "s/\x1b\[[0-9;]*m//g")
  echo -e "$colored_msg"
  if [ "${DEPLOY_LOG:-/var/log/qt-deploy.log}" != ":" ] && [ -w /var/log ] 2>/dev/null; then
    printf '%s [%s] %s\n' "$(_ts)" "$level" "$plain_msg" >> "${DEPLOY_LOG:-/var/log/qt-deploy.log}" 2>/dev/null || true
  fi
}
log()     { _log_write "INFO"  "$*"; }
log_warn(){ _log_write "WARN"  "${_YEL}$*${_NC}"; }
log_err() { _log_write "ERROR" "${_RED}$*${_NC}" >&2; }
log_ok()  { _log_write "OK"    "${_GRN}$*${_NC}"; }
log_dim() { _log_write "INFO"  "${_DIM}$*${_NC}"; }

# ---- Pre-flight 检查 ----
# 在做 docker build / restart 之类不可逆操作前调用。
# 失败时 exit 1, 输出"为什么会失败 + 怎么修"。
preflight_check() {
  local fail=0
  log "==> preflight: 检查部署前置条件"

  # 1) .env 存在 + 关键 key 都齐
  if [ ! -f ./.env ]; then
    log_err "[FAIL] .env 不存在;复制 .env.example 后填好 secret"
    fail=1
  else
    local missing=()
    for k in DATABASE_URL MIGRATION_DATABASE_URL MINIO_ACCESS_KEY MINIO_SECRET_KEY \
             CRON_SECRET NEXTAUTH_SECRET NEXTAUTH_URL APP_ENC_KEY_HEX; do
      grep -q "^${k}=" ./.env || missing+=("$k")
    done
    if [ ${#missing[@]} -gt 0 ]; then
      log_err "[FAIL] .env 缺这些 key: ${missing[*]}"
      log_err "       修法: 在 .env 末尾补全 (参照 .env.example)"
      fail=1
    else
      log_ok "  .env: 包含全部 8 个关键 key"
    fi
  fi

  # 2) git 状态: 不允许脏 (避免覆盖未提交改动)
  if command -v git >/dev/null 2>&1; then
    local dirty
    dirty=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    if [ "${dirty:-0}" != "0" ]; then
      log_err "[FAIL] git 工作区有 ${dirty} 个未提交改动,deploy 会丢失它们"
      log_err "       修法: git stash / git commit / git checkout -- <file>"
      git status --short 2>/dev/null | head -5 | sed 's/^/         /'
      fail=1
    else
      local ahead behind
      ahead=$(git rev-list --count @{u}..HEAD 2>/dev/null || echo "?")
      behind=$(git rev-list --count HEAD..@{u} 2>/dev/null || echo "?")
      log_ok "  git: 干净 (本地领先 ${ahead}, 落后 ${behind})"
    fi
  fi

  # 3) 磁盘: Docker build 缓存峰值可能吃 5GB; < 3GB 直接拒绝
  local free_gb
  free_gb=$(df -BG . 2>/dev/null | awk 'NR==2 {print $4}' | tr -d 'G')
  if [ -n "$free_gb" ] && [ "$free_gb" -lt 3 ] 2>/dev/null; then
    log_err "[FAIL] 磁盘剩余 ${free_gb}G < 3G;docker build 会中途写满"
    log_err "       修法: docker builder prune -af --keep-storage 2GB; docker image prune -f"
    fail=1
  else
    log_ok "  磁盘: 剩余 ${free_gb:-?}G"
  fi

  # 4) 可用内存 (仅 Linux, /proc/meminfo; macOS 直接跳过)
  local avail_mb=0
  if [ -r /proc/meminfo ]; then
    avail_mb=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
  fi
  if [ "${avail_mb:-0}" -gt 0 ] && [ "$avail_mb" -lt 1500 ]; then
    log_warn "  [WARN] 可用内存 ${avail_mb}MB < 1500MB;docker build 大概率 OOM (exit=137)"
    log_warn "         建议: docker stop mysql-fineui 等其它项目容器,或停 qt-postgres/qt-minio 重跑"
  elif [ "${avail_mb:-0}" -gt 0 ]; then
    log_ok "  内存: 可用 ${avail_mb}MB"
  else
    log_dim "  内存: (跳过, 非 Linux)"
  fi

  # 5) 基础容器健康
  if command -v docker >/dev/null 2>&1; then
    local bad=()
    for c in qt-postgres qt-minio; do
      local state
      state=$(docker inspect -f '{{.State.Running}}.{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' "$c" 2>/dev/null || echo "missing.missing")
      case "$state" in
        true.healthy) ;;
        true.starting) log_warn "  [WARN] $c starting (还没就绪, build 后跑 migrate 可能会撞)";;
        true.*)        bad+=("$c=unhealthy");;
        false.*)       bad+=("$c=stopped");;
        missing.*)     bad+=("$c=不存在");;
      esac
    done
    if [ ${#bad[@]} -eq 0 ]; then
      log_ok "  容器: qt-postgres + qt-minio healthy"
    else
      log_warn "  [WARN] 容器异常: ${bad[*]};deploy 会自动 docker compose up -d 拉起"
    fi
  fi

  if [ $fail -gt 0 ]; then
    log_err "preflight: ${fail} 项硬失败,终止 deploy"
    return 1
  fi
  log_ok "preflight: 全部通过"
  return 0
}

# ---- Smoke test (部署后跑) ----
smoke_test() {
  log "==> smoke test (waiting ${SMOKE_BOOT_WAIT:-3}s for app boot)"
  sleep "${SMOKE_BOOT_WAIT:-3}"
  local base="${SMOKE_BASE:-http://127.0.0.1:3000}"
  local fail=0
  for spec in \
      "login=200" \
      "dashboard=307" \
      "api/customers=401"; do
    local path="${spec%=*}"; local want="${spec#*=}"
    local got
    got=$(curl -fsS -o /dev/null -w "%{http_code}" --max-time 5 "${base}/${path}" 2>/dev/null || echo "000")
    if [ "$got" = "$want" ]; then
      log_ok "  ${path}: ${got} (匹配预期 ${want})"
    else
      log_err "  ${path}: ${got} 不等于 ${want} (预期)"
      fail=1
    fi
  done
  if [ $fail -ne 0 ]; then
    log_err "smoke test 失败;回滚: scripts/prod/rollback.sh (列出上一可用版本)"
    return 1
  fi
  log_ok "smoke test: 全部通过"
  return 0
}

# ---- 一致性 guard: 当前脚本必须以 root 或 docker 可用身份运行 ----
require_root_or_docker() {
  if [ "$(id -u)" -eq 0 ] 2>/dev/null; then
    return 0
  fi
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    return 0
  fi
  log_err "需要 root 或 docker 可用;当前 uid=$(id -u)"
  return 1
}

# ---- helper: 在 self-rewrite 场景下,_lib.sh 应已由 deploy.sh 复制到 /tmp 再 source ----
_self_check() {
  local lib="${BASH_SOURCE[0]}"
  if [ ! -r "$lib" ]; then
    echo "[FATAL] _lib.sh 不可读: $lib" >&2
    return 1
  fi
  return 0
}
_self_check || { echo "[FATAL] _lib.sh self check failed" >&2; return 1 2>/dev/null; }
