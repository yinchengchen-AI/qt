// 数据字典服务
// - 13 类白名单（不允许新建 category）
// - 增/改/启停/重排；删除 = 软停用 isActive=false
// - 客户/合同等业务表 code 外键悬空风险,不允许硬删
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { ALLOWED_DICTIONARY_CATEGORIES } from "@/lib/dictionary-categories";
import { audit } from "@/server/audit";
import type { Prisma } from "@prisma/client";

function assertAllowedCategory(cat: string) {
  if (!(ALLOWED_DICTIONARY_CATEGORIES as readonly string[]).includes(cat)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `不支持的 category: ${cat}`,
      400
    );
  }
}

export async function listAll(
  user: SessionUser,
  params: { category?: string; includeInactive?: boolean; keyword?: string; page?: number; pageSize?: number }
) {
  requirePermission(user.roleCode, RESOURCE.DICTIONARY, ACTION.READ);
  const { category, includeInactive, keyword, page = 1, pageSize = 100 } = params;
  if (category) assertAllowedCategory(category);
  const where: Prisma.DictionaryWhereInput = {
    ...(category ? { category } : {}),
    ...(includeInactive ? {} : { isActive: true }),
    ...(keyword
      ? {
          OR: [
            { code: { contains: keyword, mode: "insensitive" } },
            { label: { contains: keyword, mode: "insensitive" } }
          ]
        }
      : {})
  };
  const [list, total] = await Promise.all([
    prisma.dictionary.findMany({
      where,
      orderBy: [{ category: "asc" }, { sort: "asc" }, { code: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.dictionary.count({ where })
  ]);
  return { list, total, page, pageSize };
}

export async function getDict(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.DICTIONARY, ACTION.READ);
  const d = await prisma.dictionary.findUnique({ where: { id } });
  if (!d) throw new ApiError(ERROR_CODES.NOT_FOUND, "字典项不存在", 404);
  return d;
}

export type DictCreateInput = {
  category: string;
  code: string;
  label: string;
  sort?: number;
};

export async function createDict(actor: SessionUser, input: DictCreateInput) {
  requirePermission(actor.roleCode, RESOURCE.DICTIONARY, ACTION.CREATE);
  assertAllowedCategory(input.category);
  const dup = await prisma.dictionary.findUnique({
    where: { category_code: { category: input.category, code: input.code } }
  });
  if (dup) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `字典 ${input.category}.${input.code} 已存在`,
      409
    );
  }
  const d = await prisma.dictionary.create({
    data: {
      category: input.category,
      code: input.code,
      label: input.label,
      sort: input.sort ?? 0
    }
  });
  await audit(prisma, {
    actorId: actor.id,
    action: "DICTIONARY_CREATE",
    entity: "Dictionary",
    entityId: d.id,
    after: { category: d.category, code: d.code, label: d.label }
  });
  return d;
}

export type DictUpdateInput = Partial<{
  label: string;
  sort: number;
  isActive: boolean;
}>;

export async function updateDict(actor: SessionUser, id: string, input: DictUpdateInput) {
  requirePermission(actor.roleCode, RESOURCE.DICTIONARY, ACTION.UPDATE);
  const existing = await prisma.dictionary.findUnique({ where: { id } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "字典项不存在", 404);
  const updated = await prisma.dictionary.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.sort !== undefined ? { sort: input.sort } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
    }
  });
  await audit(prisma, {
    actorId: actor.id,
    action: "DICTIONARY_UPDATE",
    entity: "Dictionary",
    entityId: id,
    before: { label: existing.label, isActive: existing.isActive, sort: existing.sort },
    after: { label: updated.label, isActive: updated.isActive, sort: updated.sort }
  });
  return updated;
}

/** 软停用 = isActive=false;不物理删,避免业务表外键悬空 */
export async function softDisableDict(actor: SessionUser, id: string) {
  requirePermission(actor.roleCode, RESOURCE.DICTIONARY, ACTION.DELETE);
  const existing = await prisma.dictionary.findUnique({ where: { id } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "字典项不存在", 404);
  if (!existing.isActive) return existing; // noop
  const updated = await prisma.dictionary.update({
    where: { id },
    data: { isActive: false }
  });
  await audit(prisma, {
    actorId: actor.id,
    action: "DICTIONARY_DISABLE",
    entity: "Dictionary",
    entityId: id,
    before: { label: existing.label, isActive: true }
  });
  return updated;
}

export async function reorder(
  actor: SessionUser,
  items: { id: string; sort: number }[]
) {
  requirePermission(actor.roleCode, RESOURCE.DICTIONARY, ACTION.UPDATE);
  // 事务内逐条 update,任一失败回滚
  await prisma.$transaction(async (tx) => {
    for (const it of items) {
      await tx.dictionary.update({
        where: { id: it.id },
        data: { sort: it.sort }
      });
    }
  });
  await audit(prisma, {
    actorId: actor.id,
    action: "DICTIONARY_REORDER",
    entity: "Dictionary",
    entityId: items.map((i) => i.id).join(","),
    after: { count: items.length }
  });
  return { ok: true, count: items.length };
}
