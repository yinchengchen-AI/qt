#!/usr/bin/env bash
# qt-biz: 一次性切换 docker qt-app → native qt-app.service
# (v0.17+: 此脚本已被弃用 — docker qt-app 镜像已删, 不再有 docker fallback)
#
# 用法: 历史脚本;调用会自检失败并 exit 1 (docker qt-app 已不存在)
#      应急复活 docker fallback (DEPRECATED): docker build -t qt-app:latest . 反注释 docker-compose.prod.yml 的 app: 块
#
# 做的事 (历史, 不可重跑):
#   1. preflight: qt-app.service 已装且禁用, docker qt-app 还在跑
#   2. 备份 docker-compose.prod.yml (移除 app: 块, 但 pg / minio 保留)
#   3. systemctl enable --now qt-app.service (首次启动 native)
#   4. 等待 native 在 3000 起, 跑 smoke test

set -euo pipefail
cd "$(cd "$(dirname "$0")/../.." && pwd)"

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 sudo 或 root 跑 (systemctl / docker 都需要)" >&2
  exit 1
fi

# ---- preflight ----
echo "==> 检查现状"
if ! systemctl cat qt-app.service >/dev/null 2>&1; then
  echo "qt-app.service 不存在;先 sudo cp ops/qt-app.service /etc/systemd/system/ && sudo systemctl daemon-reload" >&2
  exit 1
fi
if ! docker inspect qt-app >/dev/null 2>&1; then
  echo "docker qt-app 已不在;似乎已切 native, 跑 systemctl status qt-app 看下" >&2
  exit 1
fi

# ---- 0. 停 docker qt-app (释放 3000 端口,否则 native 启不了) ----
if docker inspect -f '{{.State.Running}}' qt-app 2>/dev/null | grep -q true; then
  echo "==> 停 docker qt-app (释放 3000 端口给 native)"
  docker stop qt-app
fi

# ---- 1. 备份 docker-compose.prod.yml, 移除 app: 块 ----
if [ ! -f docker-compose.prod.yml.bak-pre-native ]; then
  cp docker-compose.prod.yml docker-compose.prod.yml.bak-pre-native
  echo "==> 备份 docker-compose.prod.yml → docker-compose.prod.yml.bak-pre-native"
fi

# 用 awk 抽出 "app:" 块并注释掉 (# service 整段缩进注释)
awk '
  BEGIN { in_app=0 }
  /^  app:/ { in_app=1; print "  # app:  # 切 native 后停用 (rollback.sh --docker 应急切回); 原始 docker-compose.prod.yml 在 docker-compose.prod.yml.bak-pre-native"; next }
  in_app && /^  [a-zA-Z]/ { in_app=0 }  # 下一个同层 service
  in_app { print "  # " $0; next }
  { print }
' docker-compose.prod.yml > docker-compose.prod.yml.tmp && mv docker-compose.prod.yml.tmp docker-compose.prod.yml

# ---- 2. systemctl enable --now qt-app ----
echo "==> systemctl enable --now qt-app"
systemctl daemon-reload
systemctl enable qt-app.service
systemctl start qt-app.service

# ---- 3. 等 native 起 ----
RESTART_OK=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if curl -fsS -o /dev/null --max-time 1 http://127.0.0.1:3000/login 2>/dev/null; then
    RESTART_OK=1
    echo "  native qt-app 在 3000 端口已就绪 (等 ${i}s)"
    break
  fi
  sleep 1
done

if [ "$RESTART_OK" -ne 1 ]; then
  echo "WARN: native 还没起 (等了 15s);看 journalctl -u qt-app -n 50" >&2
fi

# ---- 4. smoke test ----
echo "==> smoke test"
PASS=0
FAIL=0
for spec in "login=200" "dashboard=307" "api/customers=401"; do
  path="${spec%=*}"; want="${spec#*=}"
  got=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:3000/${path}" || echo 000)
  got=${got:-000}
  if [ "$got" = "$want" ]; then
    echo "  ${path}: ${got} OK"
    PASS=$((PASS+1))
  else
    echo "  ${path}: ${got} 不等于 ${want} (期望)"
    FAIL=$((FAIL+1))
  fi
done

if [ "$FAIL" -gt 0 ]; then
  echo
  echo "WARN: smoke test $FAIL 项失败,先排查 native 服务再说 deploy"
  echo "      journalctl -u qt-app -n 100"
  echo "      可手动 docker compose -f docker-compose.prod.yml.bak-pre-native up -d app 应急"
  exit 1
fi

# ---- 4.5 commit 让 git 工作区干净 (否则 deploy.sh preflight 会拦) ----
git add docker-compose.prod.yml
git commit -m "chore: switch qt-app from docker to native systemd (rollback.sh --docker 应急)" --no-verify || true

# ---- 5. 提示 ----
echo
echo "[OK] 已切 native"
echo "    (DEPRECATED) docker qt-app 已无, rollback.sh --docker 已移除"
echo "    后续日常 deploy: bash scripts/prod/deploy.sh"
echo "    后续回滚: bash scripts/prod/rollback.sh [ --to <sha> | --docker ]"
echo "    应急 (systemd 整个炸了): bash scripts/prod/rollback.sh --docker"
