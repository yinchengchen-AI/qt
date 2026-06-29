#!/usr/bin/env bash
# Cron 自检脚本 (每小时第 5 分钟跑, 跟 run-all 错开)
#
# 设计动机:
#   2025-09 ~ 2026-06-28 期间 cron 静默失败 9 个月无人察觉
#   根因是 curl -sS + 2>&1 + source .env 漏掉 CRON_SECRET, 失败完全无日志
#   本脚本从 4 个维度主动检查 cron 健康, 任何一个异常就告警
#
# 检查项:
#   1) crond/cron 服务 active          → crond 服务本身挂了?
#   2) qt-cron.log 最近 2 小时有写入    → run-all 跑了没? (主指标)
#   3) qt-app 监听 3000 端口             → API 端服务在线?
#   4) PostgreSQL 可达                   → 数据库是不是挂的?
#
# 告警渠道 (按优先级):
#   - 写日志到 /var/log/qt-cron.log (主, 运维巡检可见)
#   - 飞书 webhook (可选, 通过 FEISHU_WEBHOOK_URL env 配置)
#
# 安装 (在 qt-jobs.cron 加):
#   5 * * * * root /opt/qt/scripts/ops/cron-healthcheck.sh
#
# 用法:
#   /opt/qt/scripts/ops/cron-healthcheck.sh             # 正常自检
#   /opt/qt/scripts/ops/cron-healthcheck.sh --once      # 跑一次并退出 (deploy 后手动验证)
#   /opt/qt/scripts/ops/cron-healthcheck.sh --verbose    # 显示详细信息
#
# 退出码:
#   0 = 全部健康
#   1 = 有异常 (具体见输出)
#   2 = 脚本自身错误 (环境不对等)

set -uo pipefail

# 颜色
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
VERBOSE=0
ONCE=0
[[ "${1:-}" == "--verbose" ]] && VERBOSE=1
[[ "${1:-}" == "--once" ]] && ONCE=1

LOG_FILE="${LOG_FILE:-/var/log/qt-cron.log}"
APP_URL="${APP_URL:-http://127.0.0.1:3000}"
HEALTH_TIMEOUT=5

# 检查结果累加
FAIL=0
WARN=0
RESULTS=()

ok()    { RESULTS+=("[OK]   $1"); ((VERBOSE)) && echo -e "${GREEN}[OK]${NC}   $1"; }
warn()  { RESULTS+=("[WARN] $1"); ((VERBOSE)) && echo -e "${YELLOW}[WARN]${NC} $1"; WARN=$((WARN+1)); }
fail()  { RESULTS+=("[FAIL] $1"); ((VERBOSE)) && echo -e "${RED}[FAIL]${NC} $1"; FAIL=$((FAIL+1)); }

# 加载 .env 拿 FEISHU_WEBHOOK_URL / DATABASE_URL (跟其他 cron 任务保持一致)
if [[ -f /opt/qt/.env ]]; then
  set -a; . /opt/qt/.env; set +a
fi

# === 检查 1: crond / cron 服务 active ===
if systemctl is-active --quiet crond 2>/dev/null; then
  ok "crond 服务 active (RHEL/CentOS)"
elif systemctl is-active --quiet cron 2>/dev/null; then
  ok "cron 服务 active (Debian/Ubuntu)"
else
  fail "crond/cron 服务都未 active — 定时任务永远不会触发"
fi

# === 检查 2: qt-cron.log 最近 2 小时有写入 ===
# 这条最重要: 直接反映 cron 任务是否真的成功跑过
if [[ -f "$LOG_FILE" ]]; then
  # 取最后一行, 解析里面 json 的 "at":"..." 字段 (run-all 自带时间戳)
  LAST_AT=$(grep -oP '"at":"[^"]+"' "$LOG_FILE" 2>/dev/null | tail -1 | sed 's/"at":"//;s/"$//')
  if [[ -z "$LAST_AT" ]]; then
    fail "qt-cron.log 存在但没有有效记录 — run-all 从未成功过? 文件大小: $(stat -c%s "$LOG_FILE" 2>/dev/null || stat -f%z "$LOG_FILE") 字节"
  else
    # 计算时间差 (兼容 GNU date 和 BSD date)
    LAST_TS=$(date -d "$LAST_AT" +%s 2>/dev/null || date -j -f "%Y-%m-%dT%H:%M:%S" "${LAST_AT%.*}" +%s 2>/dev/null || echo 0)
    NOW_TS=$(date +%s)
    if [[ "$LAST_TS" -eq 0 ]]; then
      warn "qt-cron.log 最后记录时间解析失败: $LAST_AT"
    else
      AGE=$(( NOW_TS - LAST_TS ))
      AGE_HOURS=$(( AGE / 3600 ))
      if [[ $AGE -gt 7200 ]]; then  # 2 小时
        fail "qt-cron.log 最后记录已 ${AGE_HOURS} 小时前 (at=$LAST_AT) — run-all 跑挂了!"
      else
        ok "qt-cron.log 最后记录 ${AGE_HOURS} 小时前 (at=$LAST_AT)"
      fi
    fi
  fi
else
  fail "qt-cron.log 文件不存在 ($LOG_FILE) — redirect 失败或 cron 没跑过"
fi

# === 检查 3: qt-app 监听 3000 端口 ===
if command -v ss >/dev/null 2>&1; then
  if ss -tln 2>/dev/null | grep -q ":3000 "; then
    ok "qt-app 监听 3000 端口"
  else
    fail "qt-app 未监听 3000 端口 — 服务挂了?"
  fi
elif command -v netstat >/dev/null 2>&1; then
  if netstat -tln 2>/dev/null | grep -q ":3000 "; then
    ok "qt-app 监听 3000 端口 (netstat)"
  else
    fail "qt-app 未监听 3000 端口 (netstat)"
  fi
else
  warn "ss/netstat 都不可用, 跳过端口检查"
fi

# === 检查 4: API 健康检查 ===
# 直接 GET /api/jobs/run-all 不行 (那个是 POST), 用 /api/health 或 /login 替代
HEALTH_CODE=$(curl -fsS -o /dev/null -w "%{http_code}" --max-time "$HEALTH_TIMEOUT" "$APP_URL/login" 2>/dev/null || echo "000")
if [[ "$HEALTH_CODE" == "200" || "$HEALTH_CODE" == "307" ]]; then
  ok "API 健康检查 (HTTP $HEALTH_CODE)"
else
  fail "API 健康检查失败 (HTTP $HEALTH_CODE) — 应用未就绪"
fi

# === 检查 5: PostgreSQL 可达 (可选, 通过 docker exec) ===
if command -v docker >/dev/null 2>&1; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "qt-postgres"; then
    if docker exec qt-postgres pg_isready -U qt_app -d qt_biz -t 3 >/dev/null 2>&1; then
      ok "PostgreSQL 可达 (qt-postgres 容器 healthy)"
    else
      fail "PostgreSQL 不可达 (pg_isready failed)"
    fi
  else
    warn "qt-postgres 容器未运行 (可能没用 docker)"
  fi
else
  warn "docker 命令不可用, 跳过数据库检查"
fi

# === 汇总 ===
TIMESTAMP=$(date -Iseconds 2>/dev/null || date "+%Y-%m-%dT%H:%M:%S%z")
SUMMARY="[cron-healthcheck $TIMESTAMP] $((FAIL+WARN)) issues ($FAIL fail / $WARN warn)"

{
  echo "=== $SUMMARY ==="
  printf '%s\n' "${RESULTS[@]}"
  echo ""
} >> "$LOG_FILE" 2>/dev/null

# === 告警: 飞书 webhook (可选) ===
if [[ $FAIL -gt 0 && -n "${FEISHU_WEBHOOK_URL:-}" ]]; then
  # 构造飞书消息
  MSGS=""
  for r in "${RESULTS[@]}"; do
    if [[ "$r" == \[FAIL\]* ]]; then
      MSGS="${MSGS}- ${r#'[FAIL] '}\n"
    fi
  done
  PAYLOAD=$(cat <<EOF
{
  "msg_type": "interactive",
  "card": {
    "header": {
      "title": {"tag": "plain_text", "content": "🚨 qt-biz cron 健康告警"},
      "template": "red"
    },
    "elements": [
      {"tag": "markdown", "content": "**主机**: $(hostname)\n**时间**: $TIMESTAMP\n**失败项**: $FAIL"},
      {"tag": "markdown", "content": "${MSGS}"},
      {"tag": "note", "elements": [{"tag": "plain_text", "content": "查看 /var/log/qt-cron.log 获取详情"}]}
    ]
  }
}
EOF
)
  curl -fsS -X POST -H "Content-Type: application/json" \
    -d "$PAYLOAD" "$FEISHU_WEBHOOK_URL" >/dev/null 2>&1 || true
fi

# === 退出码 ===
if [[ $FAIL -gt 0 ]]; then
  exit 1
elif [[ $WARN -gt 0 ]]; then
  exit 0  # warn 不算失败, 但 cron healthcheck 应当继续跑
else
  exit 0
fi