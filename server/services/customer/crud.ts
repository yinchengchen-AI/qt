import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { nextBusinessNo } from "@/lib/sequence";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type {CustomerCreateInput, CustomerUpdateInput} from "@/lib/validators/customer";
import { buildCustomerUpdateData } from "@/lib/customer-update";
import { Prisma } from "@prisma/client";
import { rlsTransaction } from "@/lib/rls";

import {ownerEq, parseStatusList} from "@/lib/ownership";
import { softDelete } from "@/lib/soft-delete";

export async function listCustomers(
  user: SessionUser,
  params: {
    page: number;
    pageSize: number;
    keyword?: string;
    scale?: string;
    customerType?: string;
    industry?: string;
    // 地区级联 (省/市/区/镇街), 都用 equals 精确匹配 (前端 cascader 给的就是 DB 里的 label)
    province?: string;
    city?: string;
    district?: string;
    town?: string;
    ownerUserId?: string;
    createdAtFrom?: string;
    createdAtTo?: string;
  }
) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.READ);
  const { page, pageSize, keyword } = params;
  const scaleList = parseStatusList(params.scale);
  const customerTypeList = parseStatusList(params.customerType);
  const industryList = parseStatusList(params.industry);
  // createdAt 范围: 接受 ISO 字符串或 yyyy-MM-dd; 解析失败时按 undefined 处理, 不影响其他条件
  const fromDate = params.createdAtFrom ? new Date(params.createdAtFrom) : undefined;
  const toDate = params.createdAtTo ? new Date(params.createdAtTo) : undefined;
  const createdAtRange: Prisma.DateTimeFilter | undefined =
    fromDate && !Number.isNaN(fromDate.getTime()) && toDate && !Number.isNaN(toDate.getTime())
      ? { gte: fromDate, lte: toDate }
      : fromDate && !Number.isNaN(fromDate.getTime())
      ? { gte: fromDate }
      : toDate && !Number.isNaN(toDate.getTime())
      ? { lte: toDate }
      : undefined;
  const where: Prisma.CustomerWhereInput = {
    ...ownerEq(user),
    deletedAt: null,
    ...(scaleList ? { scale: { in: scaleList } } : {}),
    ...(customerTypeList ? { customerType: { in: customerTypeList } } : {}),
    ...(industryList ? { industry: { in: industryList } } : {}),
    // 地区级联 (省/市/区/镇街): 前端 cascader 给的就是 DB label, 精确匹配
    ...(params.province ? { province: { equals: params.province, mode: "insensitive" } } : {}),
    ...(params.city ? { city: { equals: params.city, mode: "insensitive" } } : {}),
    ...(params.district ? { district: { equals: params.district, mode: "insensitive" } } : {}),
    ...(params.town ? { town: { equals: params.town, mode: "insensitive" } } : {}),
    // 负责人: 精确匹配 (SALES 角色受 ownerEq 限制, 传别人 id 自然返回空集, 符合预期)
    ...(params.ownerUserId ? { ownerUserId: params.ownerUserId } : {}),
    ...(createdAtRange ? { createdAt: createdAtRange } : {}),
    ...(keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: "insensitive" } },
            { shortName: { contains: keyword, mode: "insensitive" } },
            { code: { contains: keyword, mode: "insensitive" } },
            { contactPhone: { contains: keyword, mode: "insensitive" } }
          ]
        }
      : {})
  };
  const [list, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.customer.count({ where })
  ]);
  return { list, total, page, pageSize };
}


export async function getCustomer(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.READ);
  // 客户状态机 v0.5.0 下线, status / lastAutoAppliedAt / lastAutoRule 3 列已删
  const c = await prisma.customer.findFirst({
    where: { id, deletedAt: null, ...ownerEq(user) },
    select: {
      id: true,
      code: true,
      name: true,
      shortName: true,
      unifiedSocialCreditCode: true,
      customerType: true,
      industry: true,
      sourceChannel: true,
      scale: true,
      contactName: true,
      contactTitle: true,
      contactPhone: true,
      province: true,
      city: true,
      district: true,
      town: true,
      address: true,
      ownerUserId: true,
      createdAt: true,
    }
  });
  if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
  return c;
}


export async function createCustomer(user: SessionUser, input: CustomerCreateInput) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.CREATE);
  const code = await nextBusinessNo("CUSTOMER", { yyyymm: true });
  const ownerUserId = input.ownerUserId ?? user.id;  // 默认当前用户为负责人（admin 创建时也归自己）
  return rlsTransaction(prisma, user, async (tx) => { return tx.customer.create({
    data: {
      ...input,
      code,
      ownerUserId,
      unifiedSocialCreditCode: input.unifiedSocialCreditCode || null,
      shortName: input.shortName || null,
      industry: input.industry || null,
      scale: input.scale || null,
      address: input.address || null,
      district: input.district || null,
      town: input.town || null,
      contactName: input.contactName || null,
      contactTitle: input.contactTitle || null,
      sourceChannel: input.sourceChannel || null,
      createdById: user.id,
      updatedById: user.id
    }
  }); });
}


export async function updateCustomer(user: SessionUser, id: string, input: CustomerUpdateInput) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.customer.findFirst({ where: { id, deletedAt: null, ...ownerEq(user) } });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
    if (
      input.ownerUserId &&
      input.ownerUserId !== existing.ownerUserId &&
      user.roleCode !== "ADMIN"
    ) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可转移客户负责人", 403);
    }
    return tx.customer.update({
      where: { id },
      data: buildCustomerUpdateData(input, user.id)
    });
  });
}

// 客户软删入口。客户状态机 v0.5.0 已下线,这里只做软删 + 子数据校验。

export async function softDeleteCustomer(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.DELETE);
  const existing = await prisma.customer.findFirst({
    where: { id, deletedAt: null, ...ownerEq(user) },
    select: { id: true },
  });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
  return softDelete(user, {
    entity: "Customer",
    id,
    findInTx: (tx, customerId) => tx.customer.findFirst({
      where: { id: customerId, deletedAt: null, ...ownerEq(user) },
      select: { id: true, deletedAt: true },
    }),
    updateInTx: (tx, customerId, deletedAt, actorId) => tx.customer.update({
      where: { id: customerId },
      data: { deletedAt, updatedById: actorId },
      select: { id: true, deletedAt: true },
    }),
    preDeleteCheck: async (tx) => {
      // R-14: 若有 ACTIVE 合同禁止删除
      const active = await tx.contract.count({
        where: { customerId: id, status: { in: ["ACTIVE"] }, deletedAt: null },
      });
      if (active > 0) {
        throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "客户存在进行中合同，不可删除", 403);
      }
    },
    audit: {
      actorId: user.id,
      before: { deletedAt: null },
    },
  });
}

// =====================================================
// P10: 客户 360 度视图 — 聚合 contracts/invoices/payments
// =====================================================
