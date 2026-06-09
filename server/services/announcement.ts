// 公告服务
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import type { Prisma } from "@prisma/client";

export async function listAnnouncements(
  user: SessionUser,
  params: { page: number; pageSize: number; keyword?: string }
) {
  requirePermission(user.roleCode, RESOURCE.ANNOUNCEMENT, ACTION.READ);
  const { page, pageSize, keyword } = params;
  const where: Prisma.AnnouncementWhereInput = {
    deletedAt: null,
    AND: [
      { OR: [{ targetRoles: { isEmpty: true } }, { targetRoles: { has: user.roleCode } }] },
      { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: new Date() } }] }
    ],
    ...(keyword ? { OR: [{ title: { contains: keyword, mode: "insensitive" } }, { content: { contains: keyword, mode: "insensitive" } }] } : {})
  };
  const [list, total] = await Promise.all([
    prisma.announcement.findMany({ where, orderBy: [{ pinned: "desc" }, { publishAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.announcement.count({ where })
  ]);
  return { list, total, page, pageSize };
}

export async function getAnnouncement(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.ANNOUNCEMENT, ACTION.READ);
  const a = await prisma.announcement.findFirst({ where: { id, deletedAt: null } });
  if (!a) throw new ApiError(ERROR_CODES.NOT_FOUND, "公告不存在", 404);
  return a;
}

export async function createAnnouncement(
  user: SessionUser,
  input: { title: string; content: string; pinned?: boolean; effectiveFrom?: string; effectiveTo?: string; targetRoles?: string[] }
) {
  // ADMIN 或 OPS 可以发公告（按权限矩阵：ANNOUNCEMENT CRUD = ADMIN; OPS CRUD for ANNOUNCEMENT）
  requirePermission(user.roleCode, RESOURCE.ANNOUNCEMENT, ACTION.CREATE);
  const a = await prisma.announcement.create({
    data: {
      title: input.title,
      content: input.content,
      pinned: input.pinned ?? false,
      effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : null,
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
      targetRoles: input.targetRoles ?? [],
      publishUserId: user.id
    }
  });
  await audit(prisma, { actorId: user.id, action: "ANNOUNCEMENT_CREATE", entity: "Announcement", entityId: a.id, after: { title: a.title } });
  return a;
}

export async function updateAnnouncement(
  user: SessionUser,
  id: string,
  input: Partial<{ title: string; content: string; pinned: boolean; effectiveFrom: string | null; effectiveTo: string | null; targetRoles: string[] }>
) {
  requirePermission(user.roleCode, RESOURCE.ANNOUNCEMENT, ACTION.UPDATE);
  const existing = await prisma.announcement.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "公告不存在", 404);
  const a = await prisma.announcement.update({
    where: { id },
    data: {
      ...input,
      effectiveFrom: input.effectiveFrom === undefined ? undefined : input.effectiveFrom ? new Date(input.effectiveFrom) : null,
      effectiveTo: input.effectiveTo === undefined ? undefined : input.effectiveTo ? new Date(input.effectiveTo) : null
    }
  });
  await audit(prisma, { actorId: user.id, action: "ANNOUNCEMENT_UPDATE", entity: "Announcement", entityId: id, before: { title: existing.title }, after: { title: a.title } });
  return a;
}

export async function softDeleteAnnouncement(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.ANNOUNCEMENT, ACTION.DELETE);
  const existing = await prisma.announcement.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "公告不存在", 404);
  await prisma.announcement.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(prisma, { actorId: user.id, action: "ANNOUNCEMENT_DELETE", entity: "Announcement", entityId: id, before: { title: existing.title } });
  return { ok: true };
}
