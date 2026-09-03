// 消息订阅偏好服务
//
// 缺省即视为 enabled=true：表里不存在的 (userId, type) 视为开启。
// 仅在用户**明确关闭**某类型时落行；改回开启 = 删除该行（避免 23 行×N 用户默认记录）。
//
// 调用方：
//   - GET  /api/messages/preferences → listPreferences（前端订阅设置）
//   - PUT  /api/messages/preferences → updatePreferences（用户操作）
//   - bus.emit → getDisabledMap (过滤 receivers)
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import { isSubscribable } from "@/lib/message-categories";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

type TxOrClient = Prisma.TransactionClient | PrismaClient;

/** 列出某用户所有可见 MessageType + 当前 enabled 状态。 */
export async function listPreferences(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.READ);
  const rows = await prisma.messagePreference.findMany({
    where: { userId: user.id },
    select: { type: true, enabled: true }
  });
  const map = new Map<string, boolean>(rows.map((r) => [r.type, r.enabled]));
  // 返回 SUBSCRIBABLE 全部 type，未显式存 = enabled
  const { SUBSCRIBABLE_MESSAGE_TYPES } = await import("@/lib/message-categories");
  return SUBSCRIBABLE_MESSAGE_TYPES.map((type) => ({
    type,
    enabled: map.get(type) ?? true
  }));
}

/**
 * 替换式更新：传入完整 preferences 数组，
 *   - enabled=true  → 确保 (userId, type) 不存在（缺省即开启）
 *   - enabled=false → upsert enabled=false
 * 写一条 MESSAGE_PREFERENCE_UPDATE 审计。
 */
export async function updatePreferences(
  user: SessionUser,
  input: { type: string; enabled: boolean }[]
) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.UPDATE);
  // 入参校验
  if (!Array.isArray(input)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "preferences 必须是数组", 400);
  }
  const seen = new Set<string>();
  for (const p of input) {
    if (!p || typeof p.type !== "string" || typeof p.enabled !== "boolean") {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "preference 格式错误", 400);
    }
    if (!isSubscribable(p.type)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `不可订阅的消息类型：${p.type}`,
        400
      );
    }
    if (seen.has(p.type)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `重复的 type：${p.type}`, 400);
    }
    seen.add(p.type);
  }

  const before = await prisma.messagePreference.findMany({
    where: { userId: user.id },
    select: { type: true, enabled: true }
  });
  const beforeMap = Object.fromEntries(before.map((b) => [b.type, b.enabled]));

  // 单事务：删除 enabled=true 的现有行 + upsert enabled=false 的
  await prisma.$transaction(async (tx) => {
    const enableTypes = input.filter((p) => p.enabled).map((p) => p.type);
    const disableTypes = input.filter((p) => !p.enabled);

    if (enableTypes.length > 0) {
      await tx.messagePreference.deleteMany({
        where: { userId: user.id, type: { in: enableTypes as never } }
      });
    }
    for (const p of disableTypes) {
      await tx.messagePreference.upsert({
        where: { userId_type: { userId: user.id, type: p.type as never } },
        update: { enabled: false },
        create: { userId: user.id, type: p.type as never, enabled: false }
      });
    }
  });

  const afterMap = { ...beforeMap };
  for (const p of input) afterMap[p.type] = p.enabled;

  await audit(prisma, {
    actorId: user.id,
    action: "MESSAGE_PREFERENCE_UPDATE",
    entity: "MessagePreference",
    entityId: user.id,
    before: beforeMap,
    after: afterMap
  });

  return listPreferences(user);
}

/**
 * 给定 userIds，返回每个用户**已关闭**的 type 集合。
 * bus.emit 在写 Message 前调用，避免给退订用户发信。
 *
 * 单次 in-query：where userId IN (userIds), 把结果按 userId 聚合。
 */
export async function getDisabledMap(
  userIds: string[],
  txOrClient: TxOrClient = prisma
): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (userIds.length === 0) return out;
  const rows = await txOrClient.messagePreference.findMany({
    where: { userId: { in: userIds }, enabled: false },
    select: { userId: true, type: true }
  });
  for (const r of rows) {
    let set = out.get(r.userId);
    if (!set) {
      set = new Set();
      out.set(r.userId, set);
    }
    set.add(r.type);
  }
  return out;
}
