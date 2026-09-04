// 消息中心 v2 服务层
//
// 列表/已读/删除/清空 + 批量操作 + 未读分类汇总
//
// 设计要点：
//   - 列表走 cursor-based 分页（createdAt desc + id desc），兼容老 total/page 字段
//   - types / categories 过滤走 where in，category 通过 lib/message-categories 反查
//   - q 走 title/content 模糊匹配（PG ILIKE）
//   - from/to 走 createdAt 范围
//   - 批量操作：listMessages / markAllRead / clearReadMessages / batchMutate 全部
//     复用同一 where 构造器（buildMessageWhere）
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import { categoryOf, type MessageCategory } from "@/lib/message-categories";
import { MESSAGE_TYPE } from "@/types/enums";
import { Prisma as PrismaNS, type Prisma, type MessageType } from "@prisma/client";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export type ListMessagesParams = {
  page?: number;
  pageSize?: number;
  cursor?: string | null;
  unread?: boolean;
  types?: string[];
  categories?: MessageCategory[];
  q?: string | null;
  from?: string | null;
  to?: string | null;
  /**
   * v0.24.0 回收站: true = 查 deletedAt != null (回收站视图);
   * 默认 undefined = inbox 视图, 强制 deletedAt = null
   */
  includeDeleted?: boolean;
};

/** 解码 cursor：base64({createdAt, id})。非法返回 null。 */
function decodeCursor(c: string | null | undefined): { createdAt: Date; id: string } | null {
  if (!c) return null;
  try {
    const json = Buffer.from(c, "base64url").toString("utf-8");
    const obj = JSON.parse(json) as { createdAt: string; id: string };
    if (typeof obj.id !== "string" || typeof obj.createdAt !== "string") return null;
    const d = new Date(obj.createdAt);
    if (isNaN(d.getTime())) return null;
    return { id: obj.id, createdAt: d };
  } catch {
    return null;
  }
}

export function encodeCursor(row: { id: string; createdAt: Date }): string {
  return Buffer.from(
    JSON.stringify({ id: row.id, createdAt: row.createdAt.toISOString() })
  ).toString("base64url");
}

/** 把 types + categories 合并成 where.types 列表（含 DEPRECATED 走 unknown category） */
function resolveTypeFilter(types: string[] | undefined, categories: MessageCategory[] | undefined): string[] | undefined {
  if (!types && !categories) return undefined;
  let merged: string[];
  if (types) {
    const valid = new Set(MESSAGE_TYPE as readonly string[]);
    merged = types.filter((t) => valid.has(t));
  } else {
    merged = [];
  }
  if (categories && categories.length > 0) {
    const catSet = new Set<string>(categories);
    for (const t of MESSAGE_TYPE) {
      if (catSet.has(categoryOf(t))) merged.push(t);
    }
  }
  if (merged.length === 0) {
    // 显式给了过滤但都无效：当 null 处理,后端 where.types 不会匹配任何行（避免返回全表）
    return ["__none__"];
  }
  // 去重
  return Array.from(new Set(merged));
}

/** 公共 where 构造器：被 listMessages / markAllRead / clearRead / batchMutate 复用 */
export function buildMessageWhere(
  userId: string,
  p: {
    unread?: boolean;
    types?: string[];
    categories?: MessageCategory[];
    q?: string | null;
    from?: string | null;
    to?: string | null;
    /**
     * 是否包含已软删 (deletedAt != null) 消息。
     * - undefined/false: inbox 默认行为, 加 deletedAt: null 过滤
     * - true: 回收站查询, 强制 deletedAt: { not: null }
     * - "only": 与 false 相同 (inbox)
     */
    includeDeleted?: boolean;
  }
): Prisma.MessageWhereInput {
  const where: Prisma.MessageWhereInput = { receiverUserId: userId };
  if (p.unread === true) where.readAt = null;
  else if (p.unread === false) where.readAt = { not: null };
  // v0.24.0 回收站: inbox 默认排除已软删, 回收站列表强制只看软删
  if (p.includeDeleted === true) {
    where.deletedAt = { not: null };
  } else {
    where.deletedAt = null;
  }

  const typeFilter = resolveTypeFilter(p.types, p.categories);
  if (typeFilter) where.type = { in: typeFilter as MessageType[] };

  if (p.q && p.q.trim().length > 0) {
    const term = p.q.trim();
    where.OR = [
      { title: { contains: term, mode: "insensitive" } },
      { content: { contains: term, mode: "insensitive" } }
    ];
  }

  if (p.from || p.to) {
    const range: { gte?: Date; lte?: Date } = {};
    if (p.from) {
      const d = new Date(p.from);
      if (!isNaN(d.getTime())) range.gte = d;
    }
    if (p.to) {
      const d = new Date(p.to);
      if (!isNaN(d.getTime())) range.lte = d;
    }
    if (range.gte || range.lte) where.createdAt = range;
  }

  return where;
}

export async function listMessages(user: SessionUser, params: ListMessagesParams) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.READ);

  // 兼容老客户端的 page/pageSize
  const useCursor = !!params.cursor;
  const page = params.page ?? 1;
  const pageSize = Math.min(params.pageSize ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

  const where = buildMessageWhere(user.id, { ...params, includeDeleted: params.includeDeleted });

  if (useCursor) {
    const decoded = decodeCursor(params.cursor);
    if (decoded) {
      // cursor 游标：(createdAt < decoded.createdAt) OR (createdAt = decoded.createdAt AND id < decoded.id)
      where.OR = [
        { createdAt: { lt: decoded.createdAt } },
        { AND: [{ createdAt: decoded.createdAt }, { id: { lt: decoded.id } }] }
      ];
      // AND 拼接 where 中已有 OR（q），改为 AND of (q, cursor)
      const q = params.q?.trim();
      if (q) {
        const qWhere: Prisma.MessageWhereInput = {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { content: { contains: q, mode: "insensitive" } }
          ]
        };
        where.AND = [qWhere, ...(where.OR as Prisma.MessageWhereInput[])];
        delete where.OR;
      }
    }
    const list = await prisma.message.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: pageSize + 1
    });
    const hasMore = list.length > pageSize;
    const items = hasMore ? list.slice(0, pageSize) : list;
    const last = items[items.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last) : null;
    return { list: items, nextCursor, page, pageSize, unreadCount: await getUnreadCount(user.id) };
  }

  // 老 page/pageSize 路径
  const [list, total, unreadCount] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.message.count({ where }),
    getUnreadCount(user.id)
  ]);
  return { list, total, page, pageSize, nextCursor: null, unreadCount };
}

async function getUnreadCount(userId: string): Promise<number> {
  // 不算已软删的消息, 跟 listMessages 口径一致
  return prisma.message.count({
    where: { receiverUserId: userId, readAt: null, deletedAt: null }
  });
}

export async function markRead(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.UPDATE);
  const m = await prisma.message.findFirst({
    where: { id, receiverUserId: user.id, deletedAt: null }
  });
  if (!m) throw new ApiError(ERROR_CODES.NOT_FOUND, "消息不存在或已在回收站", 404);
  if (m.readAt) return m;
  return prisma.message.update({ where: { id }, data: { readAt: new Date() } });
}

export type BatchScope = {
  types?: string[];
  categories?: MessageCategory[];
  q?: string;
  from?: string;
  to?: string;
};

export async function markAllRead(user: SessionUser, scope: BatchScope = {}) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.UPDATE);
  const where = buildMessageWhere(user.id, {
    ...scope,
    unread: true // 仅未读
  });
  const r = await prisma.message.updateMany({
    where,
    data: { readAt: new Date() }
  });
  if (r.count > 0) {
    await audit(prisma, {
      actorId: user.id,
      action: "MESSAGE_MARK_ALL_READ",
      entity: "Message",
      entityId: user.id,
      after: { count: r.count, scope }
    });
  }
  return { updated: r.count };
}

export async function countUnreadMessages(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.READ);
  return { unreadCount: await getUnreadCount(user.id) };
}

/**
 * 未读分类汇总：按 category 分组返回每个 category 的未读数。
 * 给前端 sidebar 渲染「合同 N / 财务 M」徽标。
 */
export async function unreadSummary(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.READ);
  // inbox 口径, 排除已软删
  const rows = await prisma.message.findMany({
    where: { receiverUserId: user.id, readAt: null, deletedAt: null },
    select: { type: true }
  });
  const counts: Record<string, number> = {
    contract: 0,
    finance: 0,
    reconciliation: 0,
    certificate: 0,
    system: 0,
    unknown: 0
  };
  for (const r of rows) {
    const c = categoryOf(r.type);
    counts[c] = (counts[c] ?? 0) + 1;
  }
  return { total: rows.length, byCategory: counts };
}

/**
 * 软删消息 (移到回收站)
 * v0.24.0: 之前是 hard delete, 现在只 set deletedAt, 30 天后由 runMessageRecyclePurge 真正清掉
 */
export async function softDeleteMessage(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.DELETE);
  const m = await prisma.message.findFirst({
    where: { id, receiverUserId: user.id, deletedAt: null }
  });
  if (!m) throw new ApiError(ERROR_CODES.NOT_FOUND, "消息不存在或已在回收站", 404);
  await audit(prisma, {
    actorId: user.id,
    action: "MESSAGE_RECYCLE",
    entity: "Message",
    entityId: id,
    before: { title: m.title, type: m.type }
  });
  return prisma.message.update({
    where: { id },
    data: { deletedAt: new Date() }
  });
}

/** 兼容老 API: 仍叫 deleteMessage, 实际走软删 */
export const deleteMessage = softDeleteMessage;

/**
 * 从回收站恢复消息 (owner)
 * readAt 保持原值 - "我只是把它从回收站捞回来, 仍然是同一条消息"
 */
export async function restoreMessage(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.UPDATE);
  const m = await prisma.message.findFirst({
    where: { id, receiverUserId: user.id, deletedAt: { not: null } }
  });
  if (!m) throw new ApiError(ERROR_CODES.NOT_FOUND, "消息不在回收站", 404);
  await audit(prisma, {
    actorId: user.id,
    action: "MESSAGE_RESTORE",
    entity: "Message",
    entityId: id,
    before: { deletedAt: m.deletedAt },
    after: { deletedAt: null }
  });
  return prisma.message.update({
    where: { id },
    data: { deletedAt: null }
  });
}

/**
 * 硬删消息 (owner 自己或 admin 强制)
 * 跳过 30 天等待, 立即从 DB 删除 (不可恢复)
 */
export async function purgeMessage(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.DELETE);
  const m = await prisma.message.findFirst({
    where: { id, receiverUserId: user.id, deletedAt: { not: null } }
  });
  if (!m) throw new ApiError(ERROR_CODES.NOT_FOUND, "消息不在回收站", 404);
  await audit(prisma, {
    actorId: user.id,
    action: "MESSAGE_PURGE",
    entity: "Message",
    entityId: id,
    before: { title: m.title, type: m.type, deletedAt: m.deletedAt }
  });
  return prisma.message.delete({ where: { id } });
}

/** 清空当前用户在 scope 内**已读**消息 (v0.24.0 改为软删到回收站) */
export async function clearReadMessages(user: SessionUser, scope: BatchScope = {}) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.UPDATE);
  const where = buildMessageWhere(user.id, {
    ...scope,
    // inbox 口径, buildMessageWhere 已自动加 deletedAt: null
  });
  where.readAt = { not: null };
  // 软删到回收站, 而不是直接 delete
  const r = await prisma.message.updateMany({
    where,
    data: { deletedAt: new Date() }
  });
  if (r.count > 0) {
    await audit(prisma, {
      actorId: user.id,
      action: "MESSAGE_CLEAR_READ",
      entity: "Message",
      entityId: user.id,
      after: { recycled: r.count, scope }
    });
  }
  return { recycled: r.count };
}

/**
 * 批量操作：markRead | delete (软删) | restore | purge (硬删)
 * ids 必传；上限 200 防滥用。
 *
 * v0.24.0:
 * - delete 改为软删 (deletedAt = now), 行为可恢复
 * - 新增 restore: 把回收站里 selected 行还原 (deletedAt = null)
 * - 新增 purge: 立即 hard delete, 跳过 30 天等
 */
export async function batchMutate(
  user: SessionUser,
  input: { ids: string[]; action: "markRead" | "delete" | "restore" | "purge" }
) {
  if (input.action === "markRead" || input.action === "restore") {
    requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.UPDATE);
  } else {
    requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.DELETE);
  }
  if (!Array.isArray(input.ids) || input.ids.length === 0) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "ids 不能为空", 400);
  }
  if (input.ids.length > 200) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "ids 数量上限 200", 400);
  }
  // 全部限定为自己的消息，避免越权
  const baseWhere: Prisma.MessageWhereInput = {
    id: { in: input.ids },
    receiverUserId: user.id
  };
  if (input.action === "markRead") {
    const r = await prisma.message.updateMany({
      where: { ...baseWhere, readAt: null, deletedAt: null },
      data: { readAt: new Date() }
    });
    await audit(prisma, {
      actorId: user.id,
      action: "MESSAGE_BATCH_READ",
      entity: "Message",
      entityId: user.id,
      after: { count: r.count, ids: input.ids.slice(0, 50) } // 截断,避免 PII 堆积
    });
    return { affected: r.count };
  }
  if (input.action === "delete") {
    // 软删到回收站 (inbox 范围, 已软删的不能再删)
    const sample = await prisma.message.findMany({
      where: { ...baseWhere, deletedAt: null },
      select: { type: true }
    });
    const r = await prisma.message.updateMany({
      where: { ...baseWhere, deletedAt: null },
      data: { deletedAt: new Date() }
    });
    await audit(prisma, {
      actorId: user.id,
      action: "MESSAGE_BATCH_RECYCLE",
      entity: "Message",
      entityId: user.id,
      before: { count: sample.length, types: countTypes(sample.map((s) => s.type)) },
      after: { recycled: r.count }
    });
    return { affected: r.count };
  }
  if (input.action === "restore") {
    // 从回收站恢复 (只能恢复自己软删的)
    const r = await prisma.message.updateMany({
      where: { ...baseWhere, deletedAt: { not: null } },
      data: { deletedAt: null }
    });
    await audit(prisma, {
      actorId: user.id,
      action: "MESSAGE_BATCH_RESTORE",
      entity: "Message",
      entityId: user.id,
      after: { restored: r.count, ids: input.ids.slice(0, 50) }
    });
    return { affected: r.count };
  }
  // purge (硬删, 仅已软删的能被 purge)
  const sample = await prisma.message.findMany({
    where: { ...baseWhere, deletedAt: { not: null } },
    select: { type: true }
  });
  const r = await prisma.message.deleteMany({
    where: { ...baseWhere, deletedAt: { not: null } }
  });
  await audit(prisma, {
    actorId: user.id,
    action: "MESSAGE_BATCH_PURGE",
    entity: "Message",
    entityId: user.id,
    before: { count: sample.length, types: countTypes(sample.map((s) => s.type)) },
    after: { purged: r.count }
  });
  return { affected: r.count };
}

function countTypes(types: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of types) out[t] = (out[t] ?? 0) + 1;
  return out;
}

/**
 * v0.24.0 统一管理视图: 归档 (MessageArchive) + 回收站 (Message.deletedAt != null)
 * ADMIN only, 全公司口径(与 listArchivedMessages 原行为一致, 走 admin ownerEq 行级隔离)
 *
 * mode:
 *   - "archive" (默认): 查 MessageArchive, 月份/类型/q 过滤
 *   - "recycle": 查 Message where deletedAt != null, 新增 deletedBefore/deletedAfter
 */
export async function listArchivedMessages(
  user: SessionUser,
  params: {
    page: number;
    pageSize: number;
    receiverUserId?: string;
    month?: string;
    types?: string[];
    q?: string;
    mode?: "archive" | "recycle";
    deletedBefore?: string;
    deletedAfter?: string;
  }
) {
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "需要管理员权限", 403);
  }
  const {
    page,
    pageSize,
    receiverUserId,
    month,
    types,
    q,
    mode = "archive",
    deletedBefore,
    deletedAfter
  } = params;

  if (mode === "recycle") {
    // 回收站: 查 Message with deletedAt != null
    const where: Prisma.MessageWhereInput = { deletedAt: { not: null } };
    if (receiverUserId) where.receiverUserId = receiverUserId;
    if (types && types.length > 0) where.type = { in: types as MessageType[] };
    if (q && q.trim()) {
      const term = q.trim();
      where.OR = [
        { title: { contains: term, mode: "insensitive" } },
        { content: { contains: term, mode: "insensitive" } }
      ];
    }
    if (deletedBefore || deletedAfter) {
      const range: { gte?: Date; lte?: Date } = {};
      if (deletedBefore) {
        const d = new Date(deletedBefore);
        if (!isNaN(d.getTime())) range.lte = d;
      }
      if (deletedAfter) {
        const d = new Date(deletedAfter);
        if (!isNaN(d.getTime())) range.gte = d;
      }
      if (range.gte || range.lte) where.deletedAt = range;
    }
    const [list, total] = await Promise.all([
      prisma.message.findMany({
        where,
        orderBy: { deletedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize
      }),
      prisma.message.count({ where })
    ]);
    return { list, total, page, pageSize, mode };
  }

  // archive mode (默认)
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
  if (types && types.length > 0) {
    where.type = { in: types as MessageType[] };
  }
  if (q && q.trim()) {
    const term = q.trim();
    where.OR = [
      { title: { contains: term, mode: "insensitive" } },
      { content: { contains: term, mode: "insensitive" } }
    ];
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
  return { list, total, page, pageSize, mode };
}

/**
 * 把归档行重新写回 inbox (admin 操作)
 * - 从 MessageArchive 删除源行
 * - 写入新 Message 行, readAt = null (视为新送达)
 * - 整个过程在 $transaction 内, 失败一并回滚, 不会出现"两边都有"
 */
export async function restoreArchivedToInbox(
  user: SessionUser,
  archiveId: string
): Promise<{ restored: boolean; newId: string }> {
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "需要管理员权限", 403);
  }
  return prisma.$transaction(async (tx) => {
    const row = await tx.messageArchive.findUnique({ where: { id: archiveId } });
    if (!row) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, "归档记录不存在", 404);
    }
    // 创建新 inbox 行 (新 cuid)
    const created = await tx.message.create({
      data: {
        receiverUserId: row.receiverUserId,
        type: row.type,
        title: row.title,
        content: row.content,
        link: row.link === null ? PrismaNS.JsonNull : (row.link as Prisma.InputJsonValue),
        entityKey: row.entityKey,
        readAt: null
      }
    });
    await tx.messageArchive.delete({ where: { id: archiveId } });
    await audit(tx, {
      actorId: user.id,
      action: "MESSAGE_ARCHIVE_RESTORE",
      entity: "MessageArchive",
      entityId: archiveId,
      before: { archivedId: archiveId, receiverUserId: row.receiverUserId, type: row.type },
      after: { newMessageId: created.id, receiverUserId: row.receiverUserId }
    });
    return { restored: true, newId: created.id };
  });
}

/**
 * 管理员批量恢复回收站消息 (任意 user, 仅限已软删)
 */
export async function adminRestoreRecycled(
  user: SessionUser,
  ids: string[]
): Promise<{ affected: number }> {
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "需要管理员权限", 403);
  }
  if (!ids.length) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "ids 不能为空", 400);
  }
  if (ids.length > 200) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "ids 数量上限 200", 400);
  }
  const r = await prisma.message.updateMany({
    where: { id: { in: ids }, deletedAt: { not: null } },
    data: { deletedAt: null }
  });
  await audit(prisma, {
    actorId: user.id,
    action: "MESSAGE_BATCH_RESTORE_ADMIN",
    entity: "Message",
    entityId: user.id,
    after: { restored: r.count, ids: ids.slice(0, 50) }
  });
  return { affected: r.count };
}

/**
 * 管理员批量硬删 (任意 user, 仅限已软删)
 */
export async function adminPurgeRecycled(
  user: SessionUser,
  ids: string[]
): Promise<{ affected: number }> {
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "需要管理员权限", 403);
  }
  if (!ids.length) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "ids 不能为空", 400);
  }
  if (ids.length > 200) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "ids 数量上限 200", 400);
  }
  const sample = await prisma.message.findMany({
    where: { id: { in: ids }, deletedAt: { not: null } },
    select: { type: true, receiverUserId: true }
  });
  const r = await prisma.message.deleteMany({
    where: { id: { in: ids }, deletedAt: { not: null } }
  });
  await audit(prisma, {
    actorId: user.id,
    action: "MESSAGE_BATCH_PURGE_ADMIN",
    entity: "Message",
    entityId: user.id,
    before: { count: sample.length, types: countTypes(sample.map((s) => s.type)) },
    after: { purged: r.count }
  });
  return { affected: r.count };
}

/**
 * 给 admin 归档页的接收人下拉: 返回 {id, employeeNo, name}
 * 不分页, 但限定 ACTIVE 状态, 排除 isSystem
 */
export async function listUsersForFilter(user: SessionUser) {
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "需要管理员权限", 403);
  }
  const rows = await prisma.user.findMany({
    where: { deletedAt: null, isSystem: false, status: "ACTIVE" },
    select: { id: true, employeeNo: true, name: true },
    orderBy: { employeeNo: "asc" }
  });
  return rows;
}

/**
 * v0.24.0 用户侧: 列出自己的归档 (MessageArchive where receiverUserId = self)
 * 复用了 admin listArchivedMessages 的过滤逻辑, 但去掉 ADMIN 校验, 强制 receiverUserId = self
 */
export async function listUserArchive(
  user: SessionUser,
  params: {
    page: number;
    pageSize: number;
    types?: string[];
    categories?: MessageCategory[];
    q?: string | null;
    from?: string | null;
    to?: string | null;
  }
) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.READ);
  const { page, pageSize, types, categories, q, from, to } = params;
  const where: Prisma.MessageArchiveWhereInput = { receiverUserId: user.id };

  // 合并 type / category
  const typeFilter = resolveTypeFilter(types, categories);
  if (typeFilter) where.type = { in: typeFilter as MessageType[] };

  if (q && q.trim()) {
    const term = q.trim();
    where.OR = [
      { title: { contains: term, mode: "insensitive" } },
      { content: { contains: term, mode: "insensitive" } }
    ];
  }
  if (from || to) {
    const range: { gte?: Date; lte?: Date } = {};
    if (from) {
      const d = new Date(from);
      if (!isNaN(d.getTime())) range.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!isNaN(d.getTime())) range.lte = d;
    }
    if (range.gte || range.lte) where.archivedAt = range;
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

/**
 * v0.24.0 用户侧: 列出自己的回收站 (Message where deletedAt != null AND receiverUserId = self)
 * 复用 buildMessageWhere 的过滤, includeDeleted=true 强制 deletedAt not null
 */
export async function listRecycleBin(
  user: SessionUser,
  params: {
    page: number;
    pageSize: number;
    types?: string[];
    categories?: MessageCategory[];
    q?: string | null;
    from?: string | null;
    to?: string | null;
  }
) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.READ);
  const where = buildMessageWhere(user.id, {
    ...params,
    includeDeleted: true
  });

  const [list, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { deletedAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize
    }),
    prisma.message.count({ where })
  ]);
  return { list, total, page: params.page, pageSize: params.pageSize };
}

/**
 * v0.24.0 用户侧: 从自己的归档里把消息恢复到收件箱
 * 与 admin restoreArchivedToInbox 区别: 不要求 ADMIN 角色, 但 receiverUserId 必须是 self
 */
export async function restoreUserArchive(
  user: SessionUser,
  archiveId: string
): Promise<{ restored: boolean; newId: string }> {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const row = await tx.messageArchive.findUnique({ where: { id: archiveId } });
    if (!row) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, "归档记录不存在", 404);
    }
    if (row.receiverUserId !== user.id) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "只能恢复自己的归档消息", 403);
    }
    // 创建新 inbox 行 (新 cuid), readAt = null 视为新送达
    const created = await tx.message.create({
      data: {
        receiverUserId: row.receiverUserId,
        type: row.type,
        title: row.title,
        content: row.content,
        link: row.link === null ? PrismaNS.JsonNull : (row.link as Prisma.InputJsonValue),
        entityKey: row.entityKey,
        readAt: null
      }
    });
    await tx.messageArchive.delete({ where: { id: archiveId } });
    await audit(tx, {
      actorId: user.id,
      action: "MESSAGE_ARCHIVE_RESTORE_USER",
      entity: "MessageArchive",
      entityId: archiveId,
      before: { archivedId: archiveId, type: row.type },
      after: { newMessageId: created.id }
    });
    return { restored: true, newId: created.id };
  });
}
