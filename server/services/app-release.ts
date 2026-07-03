// AppRelease 服务:应用更新记录
//
// 与 Announcement 的区别:
//   - Announcement 是一次性公告 (有生效期 / 目标角色 / 置顶),
//     可见性按 targetRoles 过滤。
//   - AppRelease 是发版日志,全员可见;每位用户的"是否已读"通过 AppReleaseRead
//     单独追踪,list/get 不需要 join Read 表(getLatestUnread 由 client 拼)。
//
// 可见性策略:deletedAt IS NULL (无 targetRoles 概念);任一登录用户都能 list/get。
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

/** 给 popup 用的"未读首发"查询:最新一条用户尚未标已读的 release。
 *  - 候选:publishedAt 倒序取首条 deletedAt IS NULL
 *  - 已读过滤:不在 AppReleaseRead 的当前用户行里
 *  - 若该用户对最新 release 已标已读 → 返回 null (弹窗不显示)
 *
 * M-5: 三个查询包在 prisma.$transaction 里(单连接快照),
 *   避免 race: 并发插入新 release / 标记已读时,totalPublished/totalRead/release
 *   不会指向不同时间点,弹窗 UI 不会出现 "totalPublished=10 totalRead=9 release 存在"
 *   但 release 实际已被标记已读这种错位。
 * m-2: orderBy 加 id desc 作为 tiebreaker,
 *   避免两条 release publishedAt 完全相同时 findFirst 拿哪条不定。 */
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
    source?: "MANUAL" | "GIT_COMMITS";
    gitFrom?: string;
    gitTo?: string;
    gitCommitCount?: number;
  }
) {
  requirePermission(user.roleCode, RESOURCE.APP_RELEASE, ACTION.CREATE);
  // m-5: 查重同 version 未软删记录; 软删后的同名 version 允许重建
  // (否则 release 内容写错后无法重新发布,只能改标题/版本号)
  // validator 已经归一化 version (M-1), 不会因为 "v0.7.0" / "0.7.0"
  // 写法不同而漏检
  const dup = await prisma.appRelease.findFirst({
    where: { version: input.version, deletedAt: null },
    select: { id: true }
  });
  if (dup) {
    throw new ApiError(
      ERROR_CODES.CONFLICT,
      `版本 ${input.version} 已有未删除的 release;如需更新内容请先在 /admin/releases 删除旧的`,
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
      source: input.source ?? "MANUAL",
      // 不传 source 时不打 gitFrom/gitTo/gitCommitCount(留 NULL)
      ...(input.gitFrom !== undefined ? { gitFrom: input.gitFrom } : {}),
      ...(input.gitTo !== undefined ? { gitTo: input.gitTo } : {}),
      ...(input.gitCommitCount !== undefined ? { gitCommitCount: input.gitCommitCount } : {}),
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
      important: r.important,
      source: r.source,
      gitFrom: r.gitFrom,
      gitTo: r.gitTo,
      gitCommitCount: r.gitCommitCount
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

/** 标记某条 release 为当前用户已读;幂等。 */
export async function markReleaseRead(user: SessionUser, releaseId: string) {
  requirePermission(user.roleCode, RESOURCE.APP_RELEASE, ACTION.READ);
  // 先确认 release 存在且未删(防 dangling id 写入 AppReleaseRead)
  const r = await prisma.appRelease.findFirst({ where: { id: releaseId, deletedAt: null } });
  if (!r) throw new ApiError(ERROR_CODES.NOT_FOUND, "更新记录不存在", 404);
  // upsert 保证幂等;unique(userId, releaseId)
  const row = await prisma.appReleaseRead.upsert({
    where: { userId_releaseId: { userId: user.id, releaseId } },
    create: { userId: user.id, releaseId, readAt: new Date() },
    update: {} // 已存在不更新 readAt,保持首次已读时间
  });
  return row;
}
