import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { nextBusinessNo } from "@/lib/sequence";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { CustomerCreateInput, CustomerUpdateInput, FollowUpCreateInput } from "@/lib/validators/customer";
import type { Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { rlsTransaction } from "@/lib/rls";

// SALES 行级隔离：列表/详情/更新自动注入 ownerUserId
function ownershipWhere(user: SessionUser): Prisma.CustomerWhereInput {
  if (user.roleCode === "SALES") {
    return { ownerUserId: user.id };
  }
  return {};
}

export async function listCustomers(
  user: SessionUser,
  params: { page: number; pageSize: number; keyword?: string; status?: string; level?: string }
) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.READ);
  const { page, pageSize, keyword, status, level } = params;
  const where: Prisma.CustomerWhereInput = {
    ...ownershipWhere(user),
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(level ? { level } : {}),
    ...(keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: "insensitive" } },
            { shortName: { contains: keyword, mode: "insensitive" } },
            { code: { contains: keyword, mode: "insensitive" } }
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
  const c = await prisma.customer.findFirst({ where: { id, deletedAt: null, ...ownershipWhere(user) } });
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
      status: "LEAD",
      ownerUserId,
      unifiedSocialCreditCode: input.unifiedSocialCreditCode || null,
      shortName: input.shortName || null,
      industry: input.industry || null,
      scale: input.scale || null,
      address: input.address || null,
      contactEmail: input.contactEmail || null,
      sourceChannel: input.sourceChannel || null,
      creditLimitAmount: input.creditLimitAmount ?? null,
      createdById: user.id,
      updatedById: user.id
    }
  }); });
}

export async function updateCustomer(user: SessionUser, id: string, input: CustomerUpdateInput) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.UPDATE);
  const existing = await prisma.customer.findFirst({ where: { id, deletedAt: null, ...ownershipWhere(user) } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
  return prisma.customer.update({
    where: { id },
    data: {
      ...input,
      unifiedSocialCreditCode: input.unifiedSocialCreditCode || null,
      shortName: input.shortName || null,
      industry: input.industry || null,
      scale: input.scale || null,
      address: input.address || null,
      contactEmail: input.contactEmail || null,
      sourceChannel: input.sourceChannel || null,
      creditLimitAmount: input.creditLimitAmount ?? null,
      updatedById: user.id
    }
  });
}

// R-02：客户 → SIGNED 必须存在至少一份 EFFECTIVE/EXECUTING/COMPLETED 合同
export async function changeCustomerStatus(user: SessionUser, id: string, status: string) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.customer.findFirst({
      where: { id, deletedAt: null, ...ownershipWhere(user) }
    });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
    if (status === "SIGNED") {
      const cnt = await tx.contract.count({
        where: { customerId: id, status: { in: ["EFFECTIVE", "EXECUTING", "COMPLETED"] } }
      });
      if (cnt === 0) {
        throw new ApiError(ERROR_CODES.CUSTOMER_STATUS_INVALID, "客户需至少一份生效中的合同", 422);
      }
    }
    // R-13：FROZEN 检查
    if (status === "FROZEN") {
      const activeContract = await tx.contract.count({
        where: { customerId: id, status: { in: ["EFFECTIVE", "EXECUTING"] } }
      });
      if (activeContract > 0) {
        throw new ApiError(ERROR_CODES.CUSTOMER_HAS_ACTIVE_CONTRACT, "客户存在进行中合同，无法冻结", 422);
      }
    }
    return tx.customer.update({ where: { id }, data: { status, updatedById: user.id } });
  });
}

export async function addFollowUp(user: SessionUser, customerId: string, input: FollowUpCreateInput) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.CREATE);
  // 行级隔离：先确认客户可见
  await getCustomer(user, customerId);
  return prisma.followUp.create({
    data: {
      customerId,
      userId: user.id,
      followAt: new Date(input.followAt),
      method: input.method,
      content: input.content,
      nextFollowAt: input.nextFollowAt ? new Date(input.nextFollowAt) : null,
      result: input.result ?? null
    }
  });
}

export async function listFollowUps(user: SessionUser, customerId: string) {
  await getCustomer(user, customerId);
  return prisma.followUp.findMany({
    where: { customerId, deletedAt: null },
    orderBy: { followAt: "desc" }
  });
}

export async function listCustomerContracts(user: SessionUser, customerId: string) {
  await getCustomer(user, customerId);
  return prisma.contract.findMany({
    where: { customerId, deletedAt: null },
    orderBy: { signDate: "desc" }
  });
}

export async function softDeleteCustomer(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.DELETE);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.customer.findFirst({ where: { id, deletedAt: null, ...ownershipWhere(user) } });
    if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
    // R-14：若有 ACTIVE 合同（含 EFFECTIVE/EXECUTING）禁止删除
    const active = await tx.contract.count({ where: { customerId: id, status: { in: ["EFFECTIVE", "EXECUTING"] }, deletedAt: null } });
    if (active > 0) throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "客户存在进行中合同，不可删除", 403);
    const before = { status: existing.status };
    const r = await tx.customer.update({ where: { id }, data: { deletedAt: new Date(), updatedById: user.id } });
    await audit(tx, { actorId: user.id, action: "CUSTOMER_SOFT_DELETE", entity: "Customer", entityId: id, before, after: { deleted: true } });
    return r;
  });
}
