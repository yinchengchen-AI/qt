// 公告服务
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import type { Prisma } from "@prisma/client";

/**
 * 公告可见性过滤：未删除 + 角色匹配 + 生效期窗口。
 * 列表 / 详情 共享同一份过滤逻辑，避免 list/get 过滤口径不一致导致越权
 * （P0-1 历史 bug：getAnnouncement 之前只查 id + deletedAt，
 *  一个 SALES 可以直接 GET /api/announcements/<admin-only-id> 读到非自己角色的公告）。
 *
 * update / softDelete 不复用本过滤——这两条路径已通过 requirePermission
 * 把角色限定在 ADMIN/OPS（见 lib/permissions.ts:60, 87）；行为不变，
 * 避免误将"操作可见范围"与"列表可见范围"绑死（如 OPS 想清理过期公告）。
 */
export function visibilityWhere(user: SessionUser): Prisma.AnnouncementWhereInput {
  return {
    deletedAt: null,
    AND: [
      { OR: [{ targetRoles: { isEmpty: true } }, { targetRoles: { has: user.roleCode } }] },
      { OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date() } }] },
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: new Date() } }] }
    ]
  };
}

export async function listAnnouncements(
  user: SessionUser,
  params: { page: number; pageSize: number; keyword?: string }
) {
  requirePermission(user.roleCode, RESOURCE.ANNOUNCEMENT, ACTION.READ);
  const { page, pageSize, keyword } = params;
  const where: Prisma.AnnouncementWhereInput = {
    AND: [
      visibilityWhere(user),
      ...(keyword
        ? [{ OR: [{ title: { contains: keyword, mode: "insensitive" as Prisma.QueryMode } }, { content: { contains: keyword, mode: "insensitive" as Prisma.QueryMode } }] }]
        : [])
    ]
  };
  const [list, total] = await Promise.all([
    prisma.announcement.findMany({ where, orderBy: [{ pinned: "desc" }, { publishAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.announcement.count({ where })
  ]);
  return { list, total, page, pageSize };
}

export async function getAnnouncement(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.ANNOUNCEMENT, ACTION.READ);
  // P0-1: 与 list 共享 visibilityWhere，防止"按 id 直接 GET 越权读到非自己角色的公告"。
  // 命中过滤失败时表现为 404，避免泄漏公告是否存在的信息。
  const a = await prisma.announcement.findFirst({ where: { AND: [{ id }, visibilityWhere(user)] } });
  if (!a) throw new ApiError(ERROR_CODES.NOT_FOUND, "公告不存在", 404);
  return a;
}

export async function createAnnouncement(
  user: SessionUser,
  input: { title: string; content: string; pinned?: boolean; effectiveFrom?: string | null; effectiveTo?: string | null; targetRoles?: string[] }
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
