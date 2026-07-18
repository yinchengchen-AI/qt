#!/usr/bin/env bash
# 日常更新部署: git pull + install + migrate + build + restart + smoke
# 用法: 在 /opt/qt 目录下, sudo -E ./scripts/prod/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "==> git pull"
git pull --ff-only

echo "==> pnpm install --frozen-lockfile"
pnpm install --frozen-lockfile

echo "==> source .env (for DATABASE_URL / MIGRATION_DATABASE_URL)"
set -a; . ./.env; set +a
echo "==> prisma migrate deploy (用 MIGRATION_DATABASE_URL 走降权账号,只 apply 不改 schema)"

# 已知问题兜底: 20260630_message_type_enum_index 想 CREATE TYPE MessageType,
# 但 20260627_message_type_enum_bootstrap 已经预创建了 (含全部 12 个值),
# 在 fresh DB 上按时间序 deploy 会撞 "type already exists".
# 跟 ci.yml 的 fallback 同步: 检测到该 migration 失败时, 手工修 schema +
# resolve --applied 跳过, 然后再 deploy 一次.
set +e
DATABASE_URL="$MIGRATION_DATABASE_URL" npm run prisma:deploy 2>&1 | tee /tmp/migrate.log
EXIT1=${PIPESTATUS[0]}
set -e
if [ $EXIT1 -eq 0 ]; then
  echo "==> prisma deploy 一次过, 无需 fallback"
elif grep -q "20260630_message_type_enum_index" /tmp/migrate.log; then
  echo "::warning::20260630_message_type_enum_index 撞 MessageType already exists, 走 enum fallback"
  # 用生产 DB 的 admin 账号 (MIGRATION_DATABASE_URL 是降权账号, 不能 ALTER TYPE)
  # 借用 .env 里的 DATABASE_URL (qt_app, BYPASSRLS) 是 admin 角色
  ADMIN_URL="${DATABASE_URL:-}"
  if [ -z "$ADMIN_URL" ]; then
    echo "[ERR] 20260630 enum fallback 需要 DATABASE_URL (admin 角色), 但 .env 里没设"
    echo "      手动跑: psql \$DATABASE_URL -c 'ALTER TABLE \"Message\" ALTER COLUMN \"type\" TYPE \"MessageType\" USING \"type\"::\"MessageType\";' -c 'CREATE INDEX \"Message_type_receiverUserId_createdAt_idx\" ON \"Message\"(\"type\", \"receiverUserId\", \"createdAt\");' && npx prisma migrate resolve --applied 20260630_message_type_enum_index && npx prisma migrate deploy"
    exit 1
  fi
  # .env 里的 DATABASE_URL 含 ?schema=public, psql 不认, 去掉
  PGURL=$(echo "$ADMIN_URL" | sed 's/?schema=public//')
  PGPASSWORD="${ADMIN_PGPASSWORD:-}" psql "$PGURL" -v ON_ERROR_STOP=1 \
    -c 'ALTER TABLE "Message" ALTER COLUMN "type" TYPE "MessageType" USING "type"::"MessageType";' \
    -c 'DROP INDEX IF EXISTS "Message_type_idx";' \
    -c 'CREATE INDEX "Message_type_receiverUserId_createdAt_idx" ON "Message"("type", "receiverUserId", "createdAt");'
  # resolve --applied 跳过 20260630
  set +e
  DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --applied 20260630_message_type_enum_index
  RESOLVE_EXIT=$?
  set -e
  if [ $RESOLVE_EXIT -ne 0 ]; then
    echo "::warning::prisma resolve --applied 返回 $RESOLVE_EXIT (可能 migration 不在 failed 状态, 继续)"
  fi
  # 再 deploy 一次
  DATABASE_URL="$MIGRATION_DATABASE_URL" npm run prisma:deploy
  echo "==> fallback 成功"
else
  echo "[ERR] prisma deploy 失败但不是已知 20260630 enum 冲突, 不走 fallback"
  tail -30 /tmp/migrate.log
  exit $EXIT1
fi

echo "==> prisma generate (sync client to current schema; postinstall only runs patch-package)"
npx --no-install prisma generate

# V8 堆大小按机器总内存自适应分档, 也可用 NODE_MAX_OLD_SPACE 显式覆盖:
#   <  4 GB RAM  → 1536 MB  (Next.js 16 Turbopack 静态分析在 3.5 GB 机器需要降堆)
#   4–8 GB RAM  → 2048 MB  (默认档位)
#   ≥  8 GB RAM  → 4096 MB  (大内存机器, 配合 BUILD_WORKERS=$(nproc) 多 worker 加速)
#
# 历史教训 (2026-07-08 部署 v0.9.7): 3.5 GB 机器 + Turbopack 静态分析阶段 RSS 涨过 2 GB,
# NODE_MAX_OLD_SPACE=2048 仍被 OOM Killed (global_oom, 旧 v0.9.6 qt-app 同时在跑占 374 MB);
# 降到 1536 + 先 systemctl stop qt-app 释放 374 MB 后通过 (总停机 ~3-4 分钟)。
# 顺带: BUILD_WORKERS=1 也是收敛 RSS 的关键, 多 worker 在小内存机器上加剧争抢。
#
# 调度 telemetry: 关闭 Next.js 上报, 与构建内存无关, 借本脚本一并设上, 保持幂等.
# /proc/meminfo 读取提到 if 外面, 即便用户显式覆盖 NODE_MAX_OLD_SPACE 也能打日志,
# 也避免 set -u 下 TOTAL_MEM_GB unbound-variable 退出 (回归 v0.9.7 部署脚本).
# meminfo 读不到 (非 Linux / 容器受限) 时 fallback 到 unknown, 自适应档位保守走 1536 MB.
TOTAL_MEM_KB=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
if [ "$TOTAL_MEM_KB" -gt 0 ]; then
  TOTAL_MEM_GB=$((TOTAL_MEM_KB / 1024 / 1024))
else
  TOTAL_MEM_GB="unknown"
fi
if [ -z "${NODE_MAX_OLD_SPACE:-}" ]; then
  if [ "$TOTAL_MEM_GB" = "unknown" ] || [ "$TOTAL_MEM_GB" -lt 4 ]; then
    NODE_MAX_OLD_SPACE=1536
  elif [ "$TOTAL_MEM_GB" -ge 8 ]; then
    NODE_MAX_OLD_SPACE=4096
  else
    NODE_MAX_OLD_SPACE=2048
  fi
fi
BUILD_WORKERS="${BUILD_WORKERS:-1}"

# 低内存兜底 (2026-07-18 v0.10.3 部署教训): Turbopack 编译的原生 (Rust) 内存 ~2.1GB,
# 与 --max-old-space-size 无关 (压 V8 堆无效, exit=137 全局 OOM); 本机被其它租户进程挤占时
# (mysql-fineui 356MB / hermes-agent 375MB), 3.5GB 机器编译必被杀。
# 编译不依赖 DB/对象存储 (页面全 dynamic), 可用内存不足时先停本项目容器腾内存,
# build 结束无论成败都拉起。只动 qt 自己的容器; mysql-fineui 属其它项目, 不自动停,
# 需要时手动 docker stop (先例见 docs/ops/deploy-ecs.md §4.6.3)。
STOPPED_QT_CONTAINERS=""
if command -v docker >/dev/null 2>&1; then
  AVAIL_MEM_MB=$(awk '/^MemAvailable:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)
  if [ "${AVAIL_MEM_MB:-0}" -gt 0 ] && [ "$AVAIL_MEM_MB" -lt 2200 ]; then
    for c in qt-postgres qt-minio; do
      if [ "$(docker inspect -f '{{.State.Running}}' "$c" 2>/dev/null)" = "true" ]; then
        echo "==> MemAvailable=${AVAIL_MEM_MB}MB < 2200MB, 临时停止 $c 腾编译内存"
        docker stop "$c" >/dev/null
        STOPPED_QT_CONTAINERS="$STOPPED_QT_CONTAINERS $c"
      fi
    done
  fi
fi

echo "==> pnpm build (BUILD_WORKERS=$BUILD_WORKERS, NODE_MAX_OLD_SPACE=${NODE_MAX_OLD_SPACE}MB, MEM_TOTAL=${TOTAL_MEM_GB}GB)"
set +e
NODE_OPTIONS="--max-old-space-size=${NODE_MAX_OLD_SPACE}" \
  NEXT_TELEMETRY_DISABLED=1 \
  NEXT_BUILD_WORKERS="$BUILD_WORKERS" \
  pnpm build
BUILD_EXIT=$?
set -e
if [ -n "$STOPPED_QT_CONTAINERS" ]; then
  echo "==> 拉起临时停止的容器:$STOPPED_QT_CONTAINERS"
  # shellcheck disable=SC2086 -- 需要按空格拆成多个参数
  docker start $STOPPED_QT_CONTAINERS >/dev/null
fi
if [ "$BUILD_EXIT" -ne 0 ]; then
  echo "[ERR] pnpm build 失败 (exit=$BUILD_EXIT)" >&2
  if [ "$BUILD_EXIT" -eq 137 ]; then
    echo "      exit=137 = OOM Kill; 内存仍不足可手动 docker stop mysql-fineui (其它项目, 356MB) 后重跑" >&2
  fi
  exit "$BUILD_EXIT"
fi
# 生产日常更新不再 seed: roles/dicts/depts/workflow templates 已在首次部署时落地,
# 重复跑 pnpm seed 会 (1) 浪费时间 (9 份 workflow template × 5 阶段 × N 任务 = 几百次 DB 写),
# (2) 即使 idempotent, 也有微弱的角色权限/部门字段被 update 覆盖风险。
# 新机器/灾备恢复/重置环境部署时, 手动跑: cd /opt/qt && pnpm seed

echo "==> systemctl restart qt-app"
systemctl restart qt-app

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
