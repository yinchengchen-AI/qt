// AppRelease 服务:应用更新记录
//
// 与 Announcement 的区别:
//   - Announcement 是一次性公告 (有生效期 / 目标角色 / 置顶),可按 targetRoles 过滤可见性。
//   - AppRelease 是发版日志,全员可见;每位用户单独追踪"是否已读"通过 AppReleaseRead。
//
// 可见性策略:deletedAt IS NULL (没有 targetRoles 概念);任一登录用户都能 list/get。
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
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
      orderBy: [{ important: "desc" }, { publishedAt: "desc" }],
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

export async function createRelease(
  user: SessionUser,
  input: {
    version: string;
    title: string;
    summary: string;
    content: string;
    important?: boolean;
  }
) {
  requirePermission(user.roleCode, RESOURCE.APP_RELEASE, ACTION.CREATE);
  // 查重:同 version 未软删记录。validator 已经要求 version 以 v 开头,
  // 直接做字符串相等比较即可,不需要额外的归一化层。
  const dup = await prisma.appRelease.findFirst({
    where: { version: input.version, deletedAt: null },
    select: { id: true }
  });
  if (dup) {
    throw new ApiError(
      ERROR_CODES.CONFLICT,
      `版本 ${input.version} 已有未删除的 release;如需更新内容请先到 /admin/releases 删除旧的`,
      409
    );
  }
  const r = await prisma.appRelease.create({
    data: {
      version: input.version,
      title: input.title,
      summary: input.summary,
      content: input.content,
      important: input.important ?? false,
      // git 相关的 source/gitFrom/gitTo/gitCommitCount 列保留以兼容存量数据;
      // 新建记录全部写入 MANUAL / null,管理员入口不暴露这些内部字段。
      source: "MANUAL",
      publishedById: user.id
    }
  });
  await audit(prisma, {
    actorId: user.id,
    action: "APP_RELEASE_CREATE",
    entity: "AppRelease",
    entityId: r.id,
    after: {
      version: r.version,
      title: r.title,
      important: r.important
    }
  });
  return r;
}

export async function updateRelease(
  user: SessionUser,
  id: string,
  input: Partial<{ version: string; title: string; summary: string; content: string; important: boolean }>
) {
  requirePermission(user.roleCode, RESOURCE.APP_RELEASE, ACTION.UPDATE);
  const existing = await prisma.appRelease.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "更新记录不存在", 404);
  const r = await prisma.appRelease.update({
    where: { id },
    data: {
      ...(input.version !== undefined ? { version: input.version } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.important !== undefined ? { important: input.important } : {})
    }
  });
  await audit(prisma, {
    actorId: user.id,
    action: "APP_RELEASE_UPDATE",
    entity: "AppRelease",
    entityId: id,
    before: { version: existing.version, title: existing.title, important: existing.important },
    after: { version: r.version, title: r.title, important: r.important }
  });
  return r;
}

export async function softDeleteRelease(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.APP_RELEASE, ACTION.DELETE);
  const existing = await prisma.appRelease.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "更新记录不存在", 404);
  await prisma.appRelease.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(prisma, {
    actorId: user.id,
    action: "APP_RELEASE_DELETE",
    entity: "AppRelease",
    entityId: id,
    before: { version: existing.version, title: existing.title }
  });
  return { ok: true };
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
