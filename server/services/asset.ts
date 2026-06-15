// 企业资产库 CRUD + 搜索
// - 跟 server/services/dictionary.ts 同模式:requirePermission → 校验 → prisma → audit
// - update 用 $queryRaw 做 jsonb 局部更新,避免覆盖未改字段
// - archive 走 status=ARCHIVED(可恢复);硬删走 softDelete(走 deletedAt)
// - 非 ADMIN 默认只读,createAsset/updateAsset 等需 ASSET EDIT 权限(ADMIN only in v1)
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { nextBusinessNo } from "@/lib/sequence";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import { rlsTransaction } from "@/lib/rls";
import { computeAssetStatus } from "@/lib/assets/status";
import type { AssetCreateInput, AssetUpdateInput, AssetListQuery } from "@/lib/validators/asset";
import { assetCreateSchema, assetUpdateSchema } from "@/lib/validators/asset";
import type { Prisma } from "@prisma/client";

export async function listAssets(user: SessionUser, params: AssetListQuery) {
  requirePermission(user.roleCode, RESOURCE.ASSET, ACTION.READ);
  const { page, pageSize, type, status, q, tags, expiringWithinDays, includeArchived } = params;
  const tagList = tags
    ? tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];
  const where: Prisma.CompanyAssetWhereInput = {
    deletedAt: null,
    ...(type ? { type } : {}),
    ...(status ? { status } : {}),
    ...(includeArchived ? {} : { NOT: { status: "ARCHIVED" } }),
    ...(tagList.length ? { tags: { hasEvery: tagList } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { description: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } }
          ]
        }
      : {})
  };
  // 即将到期窗口:与 status=EXPIRING_SOON 互斥,允许单独筛 N 天内
  if (expiringWithinDays != null) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + expiringWithinDays);
    where.validTo = { lte: cutoff, gte: new Date() };
  }
  const [list, total] = await Promise.all([
    prisma.companyAsset.findMany({
      where,
      orderBy: [{ validTo: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        attachments: {
          where: { deletedAt: null },
          orderBy: { uploadedAt: "desc" }
        }
      }
    }),
    prisma.companyAsset.count({ where })
  ]);
  return { list, total, page, pageSize };
}

export async function getAsset(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.ASSET, ACTION.READ);
  const asset = await prisma.companyAsset.findFirst({
    where: { id, deletedAt: null },
    include: {
      attachments: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" } }
    }
  });
  if (!asset) throw new ApiError(ERROR_CODES.NOT_FOUND, "资产不存在", 404);
  return asset;
}

export async function createAsset(user: SessionUser, input: AssetCreateInput) {
  requirePermission(user.roleCode, RESOURCE.ASSET, ACTION.CREATE);
  const data = assetCreateSchema.parse(input);
  const code = await nextBusinessNo("ASSET");
  const status = computeAssetStatus(data.validFrom, data.validTo);
  const asset = await rlsTransaction(prisma, user, (tx) =>
    tx.companyAsset.create({
      data: {
        code,
        type: data.type,
        name: data.name,
        description: data.description || null,
        attributes: data.attributes as Prisma.InputJsonValue,
        tags: data.tags ?? [],
        status,
        validFrom: data.validFrom ? new Date(data.validFrom) : null,
        validTo: data.validTo ? new Date(data.validTo) : null,
        ownerUserId: user.id
      }
    })
  );
  await audit(prisma, {
    actorId: user.id,
    action: "ASSET_CREATE",
    entity: "CompanyAsset",
    entityId: asset.id,
    after: { code: asset.code, type: asset.type, name: asset.name }
  });
  return asset;
}

export async function updateAsset(user: SessionUser, id: string, input: AssetUpdateInput) {
  requirePermission(user.roleCode, RESOURCE.ASSET, ACTION.UPDATE);
  const data = assetUpdateSchema.parse(input);
  const existing = await prisma.companyAsset.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "资产不存在", 404);
  // v1:type 不可改
  // 浅合并 attributes(JS 端做),然后一次 prisma.update 完成(原代码 raw SQL + prisma.update
  // 分两步不在同一事务,中间被并发改会留下脏状态;Prisma 7 对 Json 列 SET = $1 等价于 jsonb_set)
  const mergedAttributes = data.attributes
    ? { ...((existing.attributes ?? {}) as Record<string, unknown>), ...data.attributes }
    : undefined;
  // 一次 update 把所有字段一起写,失败整体回滚
  const next = await prisma.companyAsset.update({
    where: { id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.description !== undefined ? { description: data.description || null } : {}),
      ...(data.tags !== undefined ? { tags: data.tags } : {}),
      ...(data.validFrom !== undefined ? { validFrom: data.validFrom ? new Date(data.validFrom) : null } : {}),
      ...(data.validTo !== undefined ? { validTo: data.validTo ? new Date(data.validTo) : null } : {}),
      ...(mergedAttributes !== undefined ? { attributes: mergedAttributes as Prisma.InputJsonValue } : {})
    }
  });
  // 状态重算(读时真理之源)
  const nextStatus = computeAssetStatus(next.validFrom, next.validTo);
  if (nextStatus !== next.status && next.status !== "ARCHIVED") {
    await prisma.companyAsset.update({ where: { id }, data: { status: nextStatus } });
  }
  await audit(prisma, {
    actorId: user.id,
    action: "ASSET_UPDATE",
    entity: "CompanyAsset",
    entityId: id,
    before: { name: existing.name, attributes: existing.attributes },
    after: { name: next.name, attributes: next.attributes }
  });
  return next;
}

export async function archiveAsset(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.ASSET, ACTION.UPDATE);
  const existing = await prisma.companyAsset.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "资产不存在", 404);
  if (existing.status === "ARCHIVED") return existing;
  const next = await prisma.companyAsset.update({ where: { id }, data: { status: "ARCHIVED" } });
  await audit(prisma, {
    actorId: user.id,
    action: "ASSET_ARCHIVE",
    entity: "CompanyAsset",
    entityId: id
  });
  return next;
}

export async function restoreAsset(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.ASSET, ACTION.UPDATE);
  const existing = await prisma.companyAsset.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "资产不存在", 404);
  const status = computeAssetStatus(existing.validFrom, existing.validTo);
  const next = await prisma.companyAsset.update({ where: { id }, data: { status } });
  await audit(prisma, {
    actorId: user.id,
    action: "ASSET_RESTORE",
    entity: "CompanyAsset",
    entityId: id
  });
  return next;
}

/** 软删(回收站模式) */
export async function softDeleteAsset(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.ASSET, ACTION.DELETE);
  const existing = await prisma.companyAsset.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "资产不存在", 404);
  await prisma.companyAsset.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(prisma, {
    actorId: user.id,
    action: "ASSET_SOFT_DELETE",
    entity: "CompanyAsset",
    entityId: id
  });
  return { id };
}

/** 导出辅助:列定义(供 exportToXlsx 使用) */
export const ASSET_EXPORT_COLUMNS = [
  { header: "资产编号", key: "code", width: 18 },
  { header: "类型", key: "type", width: 12 },
  { header: "名称", key: "name", width: 30 },
  { header: "状态", key: "status", width: 12 },
  { header: "生效日期", key: "validFrom", width: 18, formatter: (v: unknown) => v ? new Date(String(v)).toISOString().slice(0, 10) : "" },
  { header: "到期日期", key: "validTo", width: 18, formatter: (v: unknown) => v ? new Date(String(v)).toISOString().slice(0, 10) : "" },
  { header: "标签", key: "tags", width: 24, formatter: (v: unknown) => Array.isArray(v) ? (v as string[]).join(", ") : "" },
  { header: "更新时间", key: "updatedAt", width: 18, formatter: (v: unknown) => v ? new Date(String(v)).toISOString() : "" }
] as const;
