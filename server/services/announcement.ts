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
  const [rows, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      orderBy: [{ pinned: "desc" }, { publishAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        reads: { where: { userId: user.id }, select: { readAt: true } },
        _count: { select: { reads: true } }
      }
    }),
    prisma.announcement.count({ where })
  ]);
  // 摊平 reads 为当前用户的 readAt (null = 未读), 列表页据此展示未读视觉;
  // readCount/readTotal 给管理员卡片展示 "已读 N/M 人"。
  const flat = rows.map(({ reads, _count, ...a }) => ({
    ...a,
    readAt: reads?.[0]?.readAt ?? null,
    readCount: _count?.reads ?? 0
  }));
  // 应读分母按 targetRoles 去重分组计算 (通常只有 1-2 种角色组合)
  const roleKeys = [...new Set(flat.map((a) => [...a.targetRoles].sort().join(",")))];
  const totals = new Map<string, number>();
  await Promise.all(
    roleKeys.map(async (key) => {
      const roles = key === "" ? [] : key.split(",");
      totals.set(
        key,
        await prisma.user.count({
          where: {
            deletedAt: null,
            status: "ACTIVE",
            isSystem: false,
            ...(roles.length > 0 ? { role: { code: { in: roles } } } : {})
          }
        })
      );
    })
  );
  const list = flat.map((a) => ({ ...a, readTotal: totals.get([...a.targetRoles].sort().join(",")) ?? 0 }));
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
  // 公告按发文主体管理: 只有发布人或管理员可改/删, 避免 OPS 之间互相改对方公告.
  if (existing.publishUserId !== user.id && user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅公告发布人或管理员可编辑", 403);
  }
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
  // 与 update 对齐: 只有发布人或管理员可删 (见 updateAnnouncement 注释)
  if (existing.publishUserId !== user.id && user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅公告发布人或管理员可删除", 403);
  }
  await prisma.announcement.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(prisma, { actorId: user.id, action: "ANNOUNCEMENT_DELETE", entity: "Announcement", entityId: id, before: { title: existing.title } });
  return { ok: true };
}

export async function listPinnedAnnouncements(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.ANNOUNCEMENT, ACTION.READ);
  return prisma.announcement.findMany({
    where: { ...visibilityWhere(user), pinned: true },
    orderBy: { publishAt: "desc" },
    take: 5,
  });
}

/** 标记某条公告为当前用户已读;幂等 (重复调用不刷新 readAt)。
 * 可见性复用 getAnnouncement 的 404 语义: 软删/过期/非目标角色一律 404, 防越权探测。
 */
export async function markAnnouncementRead(user: SessionUser, announcementId: string) {
  requirePermission(user.roleCode, RESOURCE.ANNOUNCEMENT, ACTION.READ);
  const a = await prisma.announcement.findFirst({
    where: { AND: [{ id: announcementId }, visibilityWhere(user)] }
  });
  if (!a) throw new ApiError(ERROR_CODES.NOT_FOUND, "公告不存在", 404);
  return prisma.announcementRead.upsert({
    where: { userId_announcementId: { userId: user.id, announcementId } },
    create: { userId: user.id, announcementId, readAt: new Date() },
    update: {} // 已存在不更新 readAt,保持首次已读时间
  });
}

/** 已读名单 + 阅读统计: 仅发布人本人或 ADMIN/OPS 可查 (与 update/softDelete 归属口径一致)。
 * 应读分母按 targetRoles 计算: 空 = 全员 ACTIVE 非系统用户; 非空 = 这些角色的用户。
 */
export async function listAnnouncementReads(user: SessionUser, announcementId: string) {
  requirePermission(user.roleCode, RESOURCE.ANNOUNCEMENT, ACTION.READ);
  const a = await prisma.announcement.findFirst({ where: { id: announcementId, deletedAt: null } });
  if (!a) throw new ApiError(ERROR_CODES.NOT_FOUND, "公告不存在", 404);
  if (a.publishUserId !== user.id && user.roleCode !== "ADMIN" && user.roleCode !== "OPS") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅公告发布人或管理员可查看已读名单", 403);
  }
  const audienceWhere: Prisma.UserWhereInput = {
    deletedAt: null,
    status: "ACTIVE",
    isSystem: false,
    ...(a.targetRoles.length > 0 ? { role: { code: { in: a.targetRoles } } } : {})
  };
  const [total, reads] = await Promise.all([
    prisma.user.count({ where: audienceWhere }),
    prisma.announcementRead.findMany({
      where: { announcementId },
      orderBy: { readAt: "asc" },
      include: { user: { select: { id: true, name: true, employeeNo: true } } }
    })
  ]);
  const readers = reads.map((r) => ({
    userId: r.userId,
    name: r.user.name,
    employeeNo: r.user.employeeNo,
    readAt: r.readAt
  }));
  return { total, readCount: readers.length, unreadCount: Math.max(0, total - readers.length), readers };
}
