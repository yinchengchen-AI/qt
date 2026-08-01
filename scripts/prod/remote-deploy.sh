#!/usr/bin/env bash
# scripts/prod/remote-deploy.sh — 在本地 Mac 触发远端 server 的 deploy.sh
#
# 设计动机 (v0.13.7 之前):
#   - 每次部署都要 ssh root@<IP> 然后 cd /opt/qt && sudo ./scripts/prod/deploy.sh
#   - 部署期不能复用本地终端 (vim 滚动 / macOS 终端 sleep / 网络抖动 会断 ssh)
#   - 没有统一的远端配置: host/port/user 散落在命令历史里
#
# 设计 (v0.13.8 起):
#   - 默认从 .deploy-target (gitignored) 读 host/user/port
#   - 默认从 Downloads/QT.pem (RSA 私钥, 已 chmod 600) 拿 SSH 密钥
#   - 全程 stream 远端 stdout/stderr, 每行加 [remote] 前缀
#   - ssh -o BatchMode=yes + ServerAliveInterval 防假死
#   - 用 tmux 在远端 hold 一个长会话来跑 deploy.sh, 本地断线不中断 deploy
#
# 用法:
#   # 1) 首次配置 (生成模板)
#   cp .deploy-target.example .deploy-target       # 改里面的 host/user/port
#   cp /Users/yinchengchen/Downloads/QT.pem ~/.ssh/qt_deploy.pem
#   chmod 600 ~/.ssh/qt_deploy.pem
#
#   # 2) 触发部署 (日常)
#   ./scripts/prod/remote-deploy.sh                 # 用默认配置
#   ./scripts/prod/remote-deploy.sh --dry-run       # 只显示 ssh 命令, 不真跑
#   DEPLOY_HOST=staging.qt.example ./scripts/prod/remote-deploy.sh --dry-run
#
#   # 3) 不想用 tmux (旧习惯)
#   ./scripts/prod/remote-deploy.sh --no-tmux
#
# 远端执行过程 (脚本会显示在本地终端):
#   [remote] ==> git pull
#   [remote] ==> docker build qt-app:v0.13.8 (APP_VERSION=v0.13.8+abc1234, ...)
#   ...

set -euo pipefail

# ---- 参数解析 ----
DRY_RUN=0
USE_TMUX=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift;;
    --no-tmux) USE_TMUX=0; shift;;
    -h|--help)
      sed -n '2,40p' "$0"; exit 0;;
    *) echo "未知参数: $1" >&2; exit 2;;
  esac
done

# ---- 定位仓库根 ----
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# ---- 加载 .deploy-target (host/user/port) ----
TARGET_FILE="${DEPLOY_TARGET_FILE:-$REPO_ROOT/.deploy-target}"
if [ -f "$TARGET_FILE" ]; then
  set -a; . "$TARGET_FILE"; set +a
fi

# ---- SSH 密钥 ----
# 优先级: DEPLOY_KEY > ~/.ssh/qt_deploy.pem > ~/Downloads/QT.pem
KEY_PATH="${DEPLOY_KEY:-${HOME}/.ssh/qt_deploy.pem}"
if [ ! -r "$KEY_PATH" ]; then
  KEY_PATH="$HOME/Downloads/QT.pem"
fi
if [ ! -r "$KEY_PATH" ]; then
  echo "[ERR] 找不到 SSH 私钥: ~/.ssh/qt_deploy.pem 或 ~/Downloads/QT.pem" >&2
  echo "       修法: cp /Users/yinchengchen/Downloads/QT.pem ~/.ssh/qt_deploy.pem && chmod 600 ~/.ssh/qt_deploy.pem" >&2
  exit 1
fi
chmod 600 "$KEY_PATH"

# ---- host/user/port ----
DEPLOY_HOST="${DEPLOY_HOST:?DEPLOY_HOST 未设置;在 .deploy-target 里填或 export DEPLOY_HOST=<IP>}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/qt}"
REMOTE_NAME="${REMOTE_NAME:-qt-prod}"

SSH_BASE=(ssh -i "$KEY_PATH" -p "$DEPLOY_PORT" -o BatchMode=yes \
                -o StrictHostKeyChecking=accept-new \
                -o ServerAliveInterval=30 -o ServerAliveCountMax=6 \
                -o ConnectTimeout=10)

# ---- 先确认连得上 ----
echo "[local] ssh ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PORT} (key=$KEY_PATH)"
echo "[local] 远端部署路径: $DEPLOY_PATH"
echo "[local] tmux=${USE_TMUX} dry-run=${DRY_RUN}"
echo

if [ "$DRY_RUN" -eq 1 ]; then
  echo "[dry-run] 上面是本地会跑的 ssh 配置, --dry-run 不会真触发 deploy"
  echo "[dry-run] 去掉 --dry-run 即真正触发"
  exit 0
fi

# ---- 检测远端 tmux 可用性 (缺 tmux 自动回落到 --no-tmux, 加告警) ----
if [ "$USE_TMUX" -eq 1 ]; then
  if ! "${SSH_BASE[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "command -v tmux >/dev/null 2>&1"; then
    echo "[local] [WARN] 远端没装 tmux, 自动回落到 --no-tmux 模式 (ssh 断线即中断 deploy)"
    USE_TMUX=0
  fi
fi

# ---- tmux 会话名 (远端 hold) ----
TMUX_SESSION="qt-deploy-$(date +%s)"
TMUX_LOG="/tmp/qt-deploy.log"

if [ "$USE_TMUX" -eq 1 ]; then
  # 把脚本本身 (deploy.sh + _lib.sh) scp 到远端 /tmp,
  # 在远端 tmux 会话里跑。理由: 避免 self-rewrite 护栏在 ssh 断线时丢脚本。
  echo "[local] 拷贝 deploy.sh + _lib.sh 到远端 /tmp ..."
  "${SSH_BASE[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "mkdir -p /tmp/qt-deploy-pkg"
  scp -i "$KEY_PATH" -P "$DEPLOY_PORT" -o BatchMode=yes -q \
    "$REPO_ROOT/scripts/prod/deploy.sh" \
    "$REPO_ROOT/scripts/prod/_lib.sh" \
    "$DEPLOY_USER@$DEPLOY_HOST:/tmp/qt-deploy-pkg/"

  REMOTE_CMD="export QT_DEPLOY_ROOT='$DEPLOY_PATH' && \
              cp /tmp/qt-deploy-pkg/deploy.sh '$DEPLOY_PATH/scripts/prod/deploy.sh' && \
              cp /tmp/qt-deploy-pkg/_lib.sh '$DEPLOY_PATH/scripts/prod/_lib.sh' && \
              tmux new-session -d -s $TMUX_SESSION 'cd $DEPLOY_PATH && sudo -E ./scripts/prod/deploy.sh 2>&1 | tee $TMUX_LOG; echo EXIT=\$? >> $TMUX_LOG' && \
              tmux list-sessions | grep $TMUX_SESSION"

  echo "[local] 远端启动 tmux 会话: $TMUX_SESSION"
  "${SSH_BASE[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$REMOTE_CMD"

  echo "[local] 开始 stream 远端日志 (Ctrl-C 不会中断远端 deploy, 用 ssh 进去 tmux attach):"
  echo "[local]   ssh -i $KEY_PATH -p $DEPLOY_PORT $DEPLOY_USER@$DEPLOY_HOST -t tmux attach -t $TMUX_SESSION"
  echo

  # Stream 远端 tmux pane 捕获 (capture-pane 持续抓)
  for i in {1..600}; do  # 最长 stream 30 分钟 (600 * 3s)
    sleep 3
    OUTPUT=$("${SSH_BASE[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "tmux capture-pane -t $TMUX_SESSION -p 2>/dev/null || echo '__NO_SESSION__'")
    if echo "$OUTPUT" | grep -q "__NO_SESSION__"; then
      echo "[local] tmux 会话已退出,停止 stream"
      break
    fi
    # 只打印新增的行 (按行号去重; 简化: 重打整个 capture-pane 末尾 50 行, 加 [remote] 前缀)
    echo "$OUTPUT" | tail -50 | sed 's/^/[remote] /'
    if echo "$OUTPUT" | grep -q "^EXIT="; then
      EXIT_CODE=$(echo "$OUTPUT" | grep -oP 'EXIT=\K\d+' | tail -1)
      echo
      echo "[local] 远端 deploy 退出码: $EXIT_CODE"
      exit "${EXIT_CODE:-1}"
    fi
  done
  echo "[local] 30 分钟 stream 超时;手动检查: ssh ... tmux attach -t $TMUX_SESSION"
  exit 124
else
  # 不走 tmux, 直接 stream (ssh 断线就完蛋)
  echo "[local] 同步执行 deploy.sh (无 tmux, 断线即中断)"
  "${SSH_BASE[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "cd '$DEPLOY_PATH' && sudo -E ./scripts/prod/deploy.sh"
fi
