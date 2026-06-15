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

/**
 * 业绩证明强约束:若选合同,合同金额必须 == contract.totalAmount
 *  - 没选 contractId:跳过(允许独立业绩)
 *  - 选了 contractId 但 contract 找不到:400
 *  - 选了 contractId,attributes.contractAmount 缺失:自动用 contract.totalAmount 回填
 *  - 选了 contractId 且金额不一致:400,带中文提示 + 差额对比
 *
 * 仅作用于 PERFORMANCE 类型;其他 type 不读 contractId
 */
async function assertPerformanceContractAmount(
  type: string,
  attributes: Record<string, unknown> | undefined
): Promise<Record<string, unknown> | undefined> {
  if (type !== "PERFORMANCE") return attributes;
  if (!attributes?.contractId) return attributes;
  const cid = String(attributes.contractId);
  const contract = await prisma.contract.findUnique({
    where: { id: cid, deletedAt: null },
    select: { totalAmount: true }
  });
  if (!contract) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      "关联的合同不存在或已删除",
      400
    );
  }
  const expected = Number(contract.totalAmount);
  if (attributes.contractAmount == null) {
    // 没填 → 自动用合同金额,省得用户手填
    return { ...attributes, contractAmount: expected };
  }
  if (Number(attributes.contractAmount) !== expected) {
    const cur = Number(attributes.contractAmount);
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `业绩金额必须等于合同金额(合同金额 ¥${expected.toLocaleString()},当前 ¥${cur.toLocaleString()})`,
      400
    );
  }
  return attributes;
}

/**
 * v1 标书素材库:校验 PERSONNEL_CERT / TEMPLATE 的类型特定字段
 *  - PERSONNEL_CERT:userId 引用 ACTIVE User
 *  - TEMPLATE:serviceType 字典存在(可选字段)
 *  - 两种类型都需要 attachmentId 存在 + 归属当前 user
 * 抛出 ApiError 阻断后续 prisma.create
 */
async function validateAssetTypeSpecific(
  user: SessionUser,
  type: string,
  attributes: Record<string, unknown> | undefined
): Promise<void> {
  if (type !== "PERSONNEL_CERT" && type !== "TEMPLATE") return;
  if (type === "PERSONNEL_CERT") {
    const userId = String(attributes?.userId ?? "");
    if (!userId) {
      throw new ApiError(ERROR_CODES.ASSET_USER_INVALID, "员工不存在或已停用", 400);
    }
    const u = await prisma.user.findFirst({
      where: { id: userId, status: "ACTIVE", deletedAt: null }
    });
    if (!u) {
      throw new ApiError(ERROR_CODES.ASSET_USER_INVALID, "员工不存在或已停用", 400);
    }
  }
  if (type === "TEMPLATE" && attributes?.serviceType) {
    const svc = await prisma.dictionary.findFirst({
      where: { category: "SERVICE_TYPE", code: String(attributes.serviceType), deletedAt: null }
    });
    if (!svc) {
      throw new ApiError(ERROR_CODES.ASSET_SERVICE_TYPE_INVALID, "服务类型无效", 400);
    }
  }
  // 附件必填 + 越权校验(回填在 rlsTransaction 内做)
  const attachmentIdKey = type === "PERSONNEL_CERT" ? "scanFileId" : "templateFileId";
  const attachmentId = String(attributes?.[attachmentIdKey] ?? "");
  if (!attachmentId) {
    throw new ApiError(
      ERROR_CODES.ASSET_ATTACHMENT_REQUIRED,
      type === "PERSONNEL_CERT" ? "请上传证书扫描件" : "请上传模板文件",
      400
    );
  }
  const att = await prisma.attachment.findFirst({ where: { id: attachmentId, deletedAt: null } });
  if (!att) {
    throw new ApiError(ERROR_CODES.ASSET_ATTACHMENT_REQUIRED, "附件不存在", 400);
  }
  if (att.uploadedById !== user.id) {
    // 防越权:不允许使用他人上传的 attachment
    throw new ApiError(ERROR_CODES.FORBIDDEN, "无权使用此附件", 403);
  }
}

/**
 * v1 标书素材库:把"tmp/ 路径下,assetId=null"的 attachment 回填到当前 assetId
 * 在 rlsTransaction 内部调用,失败则回滚整个事务
 */
async function fillAttachmentAssetId(
  tx: Prisma.TransactionClient,
  assetId: string,
  type: string,
  attributes: Record<string, unknown> | undefined
): Promise<void> {
  if (type !== "PERSONNEL_CERT" && type !== "TEMPLATE") return;
  const attachmentIdKey = type === "PERSONNEL_CERT" ? "scanFileId" : "templateFileId";
  const attachmentId = String(attributes?.[attachmentIdKey] ?? "");
  if (!attachmentId) return;
  const att = await tx.attachment.findFirst({ where: { id: attachmentId, deletedAt: null } });
  if (!att) return; // validateAssetTypeSpecific 已经验过,这里静默
  if (att.assetId === null) {
    await tx.attachment.update({ where: { id: attachmentId }, data: { assetId } });
  } else if (att.assetId !== assetId) {
    // 已被其他资产绑定 → 越权
    throw new ApiError(ERROR_CODES.FORBIDDEN, "此附件已绑定其他资产", 403);
  }
}

export async function createAsset(user: SessionUser, input: AssetCreateInput) {
  requirePermission(user.roleCode, RESOURCE.ASSET, ACTION.CREATE);
  const data = assetCreateSchema.parse(input);
  // 强约束:PERFORMANCE 选了合同,金额必须一致(同时允许自动回填)
  const validatedAttrs = await assertPerformanceContractAmount(data.type, data.attributes as Record<string, unknown>);
  // v1 标书素材库:类型特定字段预校验(抛错则不写 DB,避免 dangling asset)
  await validateAssetTypeSpecific(user, data.type, data.attributes as Record<string, unknown> | undefined);
  const code = await nextBusinessNo("ASSET");
  const status = computeAssetStatus(data.validFrom, data.validTo);
  const asset = await rlsTransaction(prisma, user, async (tx) => {
    const created = await tx.companyAsset.create({
      data: {
        code,
        type: data.type,
        name: data.name,
        description: data.description || null,
        attributes: validatedAttrs as Prisma.InputJsonValue,
        tags: data.tags ?? [],
        status,
        validFrom: data.validFrom ? new Date(data.validFrom) : null,
        validTo: data.validTo ? new Date(data.validTo) : null,
        ownerUserId: user.id
      }
    });
    // 附件 assetId 回填(在同一事务内,失败回滚)
    await fillAttachmentAssetId(tx, created.id, data.type, data.attributes as Record<string, unknown> | undefined);
    return created;
  });
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
  // v1:type 不可改,强约束 PERFORMANCE 合同金额
  // 浅合并(JS 端做),然后一次 prisma.update;Prisma 7 对 Json 列 SET = $1 等价于 jsonb_set
  const candidateMerged = data.attributes
    ? { ...((existing.attributes ?? {}) as Record<string, unknown>), ...data.attributes }
    : undefined;
  // 强约束:PERFORMANCE 选合同 → 合同金额必须 = contract.totalAmount
  // 注意:编辑时用 existing.type(因为 type 字段不可改);attributes 用合并后的值校验
  const validatedAttrs = await assertPerformanceContractAmount(
    existing.type,
    candidateMerged
  );
  // v1 标书素材库:PERSONNEL_CERT/TEMPLATE 编辑时类型特定校验(仅当 attributes 在变)
  if (
    candidateMerged !== undefined &&
    (existing.type === "PERSONNEL_CERT" || existing.type === "TEMPLATE")
  ) {
    await validateAssetTypeSpecific(user, existing.type, candidateMerged);
  }
  // assertPerformanceContractAmount 可能自动补 contractAmount,需要把补的内容也写回去
  const mergedAttributes = data.attributes
    ? (validatedAttrs as Record<string, unknown>)
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
