#!/usr/bin/env bash
# prisma migrate deploy 封装:处理 fresh DB 完整重放时的已知历史雷区。
#
# 背景(详见 prisma/migrations/README.md #29 与迁移文件内注释):
#   20260627_message_type_enum_bootstrap 为解决时序死锁预建了 12 值的 MessageType enum(superset),
#   导致 20260630_message_type_enum_index 的裸 CREATE TYPE "MessageType" 在 fresh DB 上
#   必报 42710 duplicate_object。历史 dev/prod DB 是手工按依赖顺序应用的,不会撞;
#   只有 fresh DB(CI、新机器)完整重放才会。
#
# 第二个雷区(20260817_reconciliation_fixes):
#   该迁移含 `ALTER TABLE "BankTransaction" ADD COLUMN paymentPrevStatus`,但文件名排序
#   先于建表迁移 20260820_bank_reconciliation。历史 DB 早已建表,正常应用无碍;
#   fresh DB 重放到 20260817 时表还不存在,必报 42P01 relation does not exist。
#   处理:先手动补 4 条幂等 ALTER TYPE enum DDL(不依赖表),resolve --applied 标记,
#   续跑全部迁移建表后,再幂等补列 (IF NOT EXISTS)。
#
# 安全边界:只有 deploy 报错的失败迁移恰为上述两个已知雷区之一时才走 resolve
# (判定依据是 deploy 的 P3018 输出 "Migration name: <name>";
#  migrate status 不会点名失败迁移,不能用它判)。
# 其它迁移失败属于真实错误,原样输出并报错退出,绝不做 resolve(AGENTS.md:不要凭空标记)。
#
# 使用方:scripts/dev/dev-up.sh(dev:setup)、.github/workflows/ci.yml、新机器手工 bootstrap。
# 前置:已安装依赖(pnpm exec prisma 可用)+ DATABASE_URL 可达。
set -euo pipefail

run_deploy() {
  pnpm exec prisma migrate deploy 2>&1
}

resolve_20260817() {
  echo "[migrate-deploy] fresh DB 已知雷区:20260817 先于 20260820 建表,先补幂等 enum DDL 再 resolve"
  # enum DDL 不依赖 BankTransaction 表, 与迁移文件内容一致且幂等
  pnpm exec prisma db execute --stdin <<'SQL'
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_AUTO_MATCHED';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_SUGGESTION';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_DISCREPANCY';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'RECONCILIATION_WEEKLY_REPORT';
SQL
  pnpm exec prisma migrate resolve --applied 20260817_reconciliation_fixes
}

is_20260817_landmine() {
  grep -q 'Migration name: 20260817_reconciliation_fixes' <<< "$1" \
    && grep -q 'relation "BankTransaction" does not exist' <<< "$1"
}

# 两个雷区可能先后触发 (20260630 在 20260817 之前), 循环处理直到 deploy 通过或撞到未知失败
attempt=0
while true; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 4 ]; then
    echo "[migrate-deploy] resolve 循环超过 4 次, 异常退出" >&2
    exit 1
  fi
  if deploy_out="$(run_deploy)"; then
    echo "$deploy_out"
    break
  fi
  echo "$deploy_out"

  if grep -q 'Migration name: 20260630_message_type_enum_index' <<< "$deploy_out"; then
    echo "[migrate-deploy] fresh DB 已知雷区:20260630 CREATE TYPE 撞 20260627 预建 enum,走 resolve 路径"
    pnpm exec prisma migrate resolve --applied 20260630_message_type_enum_index
    # 补 20260630 被跳过的剩余 DDL(与 prisma/migrations/README.md #29 一致)
    pnpm exec prisma db execute --stdin <<'SQL'
ALTER TABLE "Message" ALTER COLUMN "type" TYPE "MessageType" USING "type"::"MessageType";
DROP INDEX IF EXISTS "Message_type_idx";
CREATE INDEX "Message_type_receiverUserId_createdAt_idx" ON "Message"("type", "receiverUserId", "createdAt");
SQL
  elif is_20260817_landmine "$deploy_out"; then
    resolve_20260817
  else
    echo "[migrate-deploy] migrate deploy 失败,且失败迁移不是已知雷区,不自动 resolve" >&2
    exit 1
  fi
done

# 20260817 雷区的补偿列 (此时 20260820 已建表;IF NOT EXISTS 幂等,非雷区路径也无副作用)
pnpm exec prisma db execute --stdin <<'SQL'
ALTER TABLE "BankTransaction" ADD COLUMN IF NOT EXISTS "paymentPrevStatus" TEXT;
SQL

echo "[migrate-deploy] 全部迁移已应用 (含已知雷区补偿)"
