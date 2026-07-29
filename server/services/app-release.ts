// AppRelease 服务:应用更新记录
//
// 与 Announcement 的区别:
//   - Announcement 是一次性公告 (有生效期 / 目标角色 / 置顶),可按 targetRoles 过滤可见性。
//   - AppRelease 是发版日志,全员可见;每位用户单独追踪"是否已读"通过 AppReleaseRead。
//
// 可见性策略:deletedAt IS NULL (没有 targetRoles 概念);任一登录用户都能 list/get。
//
// 写入路径:全自动发布 — scripts/release/publish.ts(deploy.sh 在镜像构建后执行)
// 直接用 Prisma 写库,不经本服务;手工创建/编辑/删除入口已移除。
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";

/** list 通用 where:已发布 + 未删;keyword 在 title/summary 上做大小写不敏感搜索 */
function baseWhere(keyword?: string): Prisma.AppReleaseWhereInput {
  return {
    AND: [
      { deletedAt: null },
      ...(keyword
        ? [
            {
              OR: [
                { title: { contains: keyword, mode: "insensitive" as Prisma.QueryMode } },
                { summary: { contains: keyword, mode: "insensitive" as Prisma.QueryMode } }
              ]
            }
          ]
        : [])
    ]
  };
}

export async function listReleases(
  user: SessionUser,
  params: { page: number; pageSize: number; keyword?: string }
) {
  requirePermission(user.roleCode, RESOURCE.APP_RELEASE, ACTION.READ);
  const { page, pageSize, keyword } = params;
  const where = baseWhere(keyword);
  const [list, total] = await Promise.all([
    prisma.appRelease.findMany({
      where,
      // 纯时间倒序:important 只影响弹窗视觉与未读首条选择,不在列表页置顶
      orderBy: [{ publishedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.appRelease.count({ where })
  ]);
  return { list, total, page, pageSize };
}

/** 给 popup 用的"未读首条"查询:最新一条用户尚未标记已读的 release。
 * 三个查询包在 prisma.$transaction 里,避免并发标记已读时 race。
 */
export async function getLatestUnreadRelease(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.APP_RELEASE, ACTION.READ);
  const [release, totalPublished, totalRead] = await prisma.$transaction([
    prisma.appRelease.findFirst({
      where: {
        deletedAt: null,
        reads: { none: { userId: user.id } }
      },
      orderBy: [{ important: "desc" }, { publishedAt: "desc" }, { id: "desc" }]
    }),
    prisma.appRelease.count({ where: { deletedAt: null } }),
    prisma.appReleaseRead.count({ where: { userId: user.id } })
  ]);
  return { release, totalPublished, totalRead };
}

export async function getRelease(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.APP_RELEASE, ACTION.READ);
  const r = await prisma.appRelease.findFirst({ where: { id, deletedAt: null } });
  if (!r) throw new ApiError(ERROR_CODES.NOT_FOUND, "更新记录不存在", 404);
  return r;
}

/** 标记某条 release 为当前用户已读 */
export async function markReleaseRead(user: SessionUser, releaseId: string) {
  requirePermission(user.roleCode, RESOURCE.APP_RELEASE, ACTION.READ);
  const r = await prisma.appRelease.findFirst({ where: { id: releaseId, deletedAt: null } });
  if (!r) throw new ApiError(ERROR_CODES.NOT_FOUND, "更新记录不存在", 404);
  const row = await prisma.appReleaseRead.upsert({
    where: { userId_releaseId: { userId: user.id, releaseId } },
    create: { userId: user.id, releaseId, readAt: new Date() },
    update: {} // 已存在不更新 readAt,保持首次已读时间
  });
  return row;
}
