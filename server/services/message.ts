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
    ...(unread ? { readAt: null } : {})
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
