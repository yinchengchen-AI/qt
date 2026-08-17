#!/usr/bin/env bash
# prisma migrate deploy 封装:处理 fresh DB 完整重放时的已知历史雷区。
#
# 背景(详见 prisma/migrations/README.md #29 与迁移文件内注释):
#   20260627_message_type_enum_bootstrap 为解决时序死锁预建了 12 值的 MessageType enum(superset),
#   导致 20260630_message_type_enum_index 的裸 CREATE TYPE "MessageType" 在 fresh DB 上
#   必报 42710 duplicate_object。历史 dev/prod DB 是手工按依赖顺序应用的,不会撞;
#   只有 fresh DB(CI、新机器)完整重放才会。
#
# 文档化修复路径(本脚本自动执行):
#   1) prisma migrate resolve --applied 20260630_message_type_enum_index
#   2) 手动补该迁移被跳过的剩余 DDL(Message.type text→enum 列转换 + 复合索引)
#   3) 重新 prisma migrate deploy 继续后续迁移
#
# 安全边界:只有 deploy 报错的失败迁移恰为 20260630_message_type_enum_index 时才走 resolve
# (判定依据是 deploy 的 P3018 输出 "Migration name: <name>";
#  migrate status 不会点名失败迁移,不能用它判)。
# 其它迁移失败属于真实错误,原样输出并报错退出,绝不做 resolve(AGENTS.md:不要凭空标记)。
#
# 使用方:scripts/dev/dev-up.sh(dev:setup)、.github/workflows/ci.yml、新机器手工 bootstrap。
# 前置:已安装依赖(pnpm exec prisma 可用)+ DATABASE_URL 可达。
set -euo pipefail

if deploy_out="$(pnpm exec prisma migrate deploy 2>&1)"; then
  echo "$deploy_out"
  exit 0
fi
echo "$deploy_out"

if ! grep -q 'Migration name: 20260630_message_type_enum_index' <<< "$deploy_out"; then
  echo "[migrate-deploy] migrate deploy 失败,且失败迁移不是已知雷区 20260630_message_type_enum_index,不自动 resolve" >&2
  exit 1
fi

echo "[migrate-deploy] fresh DB 已知雷区:20260630 CREATE TYPE 撞 20260627 预建 enum,走 resolve 路径"
pnpm exec prisma migrate resolve --applied 20260630_message_type_enum_index

# 补 20260630 被跳过的剩余 DDL(与 prisma/migrations/README.md #29 一致)
pnpm exec prisma db execute --stdin <<'SQL'
ALTER TABLE "Message" ALTER COLUMN "type" TYPE "MessageType" USING "type"::"MessageType";
DROP INDEX IF EXISTS "Message_type_idx";
CREATE INDEX "Message_type_receiverUserId_createdAt_idx" ON "Message"("type", "receiverUserId", "createdAt");
SQL

pnpm exec prisma migrate deploy
echo "[migrate-deploy] resolve 路径完成,全部迁移已应用"
