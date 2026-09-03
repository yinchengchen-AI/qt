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
import type { Prisma, MessageType } from "@prisma/client";

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
  p: { unread?: boolean; types?: string[]; categories?: MessageCategory[]; q?: string | null; from?: string | null; to?: string | null }
): Prisma.MessageWhereInput {
  const where: Prisma.MessageWhereInput = { receiverUserId: userId };
  if (p.unread === true) where.readAt = null;
  else if (p.unread === false) where.readAt = { not: null };

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

  const where = buildMessageWhere(user.id, params);

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
  return prisma.message.count({ where: { receiverUserId: userId, readAt: null } });
}

export async function markRead(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.UPDATE);
  const m = await prisma.message.findFirst({ where: { id, receiverUserId: user.id } });
  if (!m) throw new ApiError(ERROR_CODES.NOT_FOUND, "消息不存在", 404);
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
  const rows = await prisma.message.findMany({
    where: { receiverUserId: user.id, readAt: null },
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

export async function deleteMessage(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.DELETE);
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

/** 清空当前用户在 scope 内**已读**消息 */
export async function clearReadMessages(user: SessionUser, scope: BatchScope = {}) {
  requirePermission(user.roleCode, RESOURCE.MESSAGE, ACTION.UPDATE);
  const where = buildMessageWhere(user.id, {
    ...scope,
    // unread 反向：仅清已读；与 buildMessageWhere 配合 unread=undefined 表示两种都包含,这里强制 not null
  });
  where.readAt = { not: null };
  const r = await prisma.message.deleteMany({ where });
  if (r.count > 0) {
    await audit(prisma, {
      actorId: user.id,
      action: "MESSAGE_CLEAR_READ",
      entity: "Message",
      entityId: user.id,
      after: { deleted: r.count, scope }
    });
  }
  return { deleted: r.count };
}

/**
 * 批量操作：markRead | delete
 * ids 必传；上限 200 防滥用。
 */
export async function batchMutate(
  user: SessionUser,
  input: { ids: string[]; action: "markRead" | "delete" }
) {
  if (input.action === "markRead") {
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
      where: { ...baseWhere, readAt: null },
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
  // delete
  // 审计：仅记录 id 数量 + 类型分布, 不写 title/content
  const sample = await prisma.message.findMany({
    where: baseWhere,
    select: { type: true }
  });
  const r = await prisma.message.deleteMany({ where: baseWhere });
  await audit(prisma, {
    actorId: user.id,
    action: "MESSAGE_BATCH_DELETE",
    entity: "Message",
    entityId: user.id,
    before: { count: sample.length, types: countTypes(sample.map((s) => s.type)) },
    after: { deleted: r.count }
  });
  return { affected: r.count };
}

function countTypes(types: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of types) out[t] = (out[t] ?? 0) + 1;
  return out;
}

/**
 * 列出归档消息 (MessageArchive),只读 + ADMIN 角色限定。
 *
 * 入参 month (YYYY-MM) 可选; 不传时返回最近 N 条; 传时只返回该月。
 * receiverUserId 过滤可选,用于单人历史回查。
 * types / q 过滤:见 v0.22 设计文档 §3.1。
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
  }
) {
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "需要管理员权限", 403);
  }
  const { page, pageSize, receiverUserId, month, types, q } = params;

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
  return { list, total, page, pageSize };
}
