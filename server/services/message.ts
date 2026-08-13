// 消息服务
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import type { Prisma } from "@prisma/client";

export async function listMessages(
  user: SessionUser,
  params: { page: number; pageSize: number; unread?: boolean }
) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.READ);
  const { page, pageSize, unread } = params;
  const where: Prisma.MessageWhereInput = {
    receiverUserId: user.id,
    ...(unread === true ? { readAt: null } : unread === false ? { readAt: { not: null } } : {})
  };
  const [list, total, unreadCount] = await Promise.all([
    prisma.message.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.message.count({ where }),
    prisma.message.count({ where: { receiverUserId: user.id, readAt: null } })
  ]);
  return { list, total, page, pageSize, unreadCount };
}

export async function markRead(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.UPDATE);
  const m = await prisma.message.findFirst({ where: { id, receiverUserId: user.id } });
  if (!m) throw new ApiError(ERROR_CODES.NOT_FOUND, "消息不存在", 404);
  if (m.readAt) return m; // idempotent
  return prisma.message.update({ where: { id }, data: { readAt: new Date() } });
}

export async function markAllRead(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.UPDATE);
  const r = await prisma.message.updateMany({
    where: { receiverUserId: user.id, readAt: null },
    data: { readAt: new Date() }
  });
  // 单条审计:不写每条被标已读的消息(title/content 含客户/合同号属 PII),只留一条"用户清空"的痕迹
  if (r.count > 0) {
    await audit(prisma, {
      actorId: user.id,
      action: "MESSAGE_MARK_ALL_READ",
      entity: "Message",
      entityId: user.id,
      after: { count: r.count }
    });
  }
  return { updated: r.count };
}

export async function countUnreadMessages(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.READ);
  const unreadCount = await prisma.message.count({
    where: { receiverUserId: user.id, readAt: null }
  });
  return { unreadCount };
}

export async function deleteMessage(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.DELETE);
  // 只能删自己的
  const m = await prisma.message.findFirst({ where: { id, receiverUserId: user.id } });
  if (!m) throw new ApiError(ERROR_CODES.NOT_FOUND, "消息不存在", 404);
  await audit(prisma, {
    actorId: user.id,
    action: "MESSAGE_DELETE",
    entity: "Message",
    entityId: id,
    before: { title: m.title, type: m.type }
  });
  return prisma.message.delete({ where: { id } });
}

/**
 * 清空当前用户所有已读消息(硬删除),与 markAllRead 区分:
 * - markAllRead: 仅把 readAt 从 null → now,行保留在表里
 * - clearRead: delete * where readAt != null,真正从 inbox 删除
 *
 * 写一条 audit (entityId = userId,action = MESSAGE_CLEAR_READ)。
 * 不写每条删除痕迹 (PII),与 markAllRead 对齐。
 */
export async function clearReadMessages(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.UPDATE);
  const r = await prisma.message.deleteMany({
    where: { receiverUserId: user.id, readAt: { not: null } }
  });
  if (r.count > 0) {
    await audit(prisma, {
      actorId: user.id,
      action: "MESSAGE_CLEAR_READ",
      entity: "Message",
      entityId: user.id,
      after: { deleted: r.count }
    });
  }
  return { deleted: r.count };
}

/**
 * 列出归档消息 (MessageArchive),只读 + ADMIN 角色限定。
 *
 * 入参 month (YYYY-MM) 可选; 不传时返回最近 N 条; 传时只返回该月。
 * receiverUserId 过滤可选,用于单人历史回查。
 */
export async function listArchivedMessages(
  user: SessionUser,
  params: { page: number; pageSize: number; receiverUserId?: string; month?: string }
) {
  // 双层守卫:Matrix 已配 ADMIN,这里再显式 throw 防止误调用
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "需要管理员权限", 403);
  }
  const { page, pageSize, receiverUserId, month } = params;

  const where: Prisma.MessageArchiveWhereInput = {};
  if (receiverUserId) where.receiverUserId = receiverUserId;
  if (month) {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const from = new Date(Date.UTC(y, mo - 1, 1));
      const to = new Date(Date.UTC(y, mo, 1));
      where.archivedAt = { gte: from, lt: to };
    }
  }

  const [list, total] = await Promise.all([
    prisma.messageArchive.findMany({
      where,
      orderBy: { archivedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.messageArchive.count({ where })
  ]);
  return { list, total, page, pageSize };
}
