// 角色管理服务（仅 ADMIN）
// 护栏：
//   - 系统角色（isSystem=true）不可删
//   - 改 name/description/permissions 允许；改 code 允许（要校验唯一）
//   - 删：硬删，前置检查 User 表无引用
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION, ROLE_PERMISSIONS } from "@/lib/permissions";
import { audit } from "@/server/audit";
import type { Prisma } from "@prisma/client";

export async function listRoles(
  user: SessionUser,
  params: { page: number; pageSize: number; keyword?: string }
) {
  requirePermission(user.roleCode, RESOURCE.ROLE, ACTION.READ);
  const { page, pageSize, keyword } = params;
  const where: Prisma.RoleWhereInput = {
    ...(keyword
      ? {
          OR: [
            { code: { contains: keyword, mode: "insensitive" } },
            { name: { contains: keyword, mode: "insensitive" } }
          ]
        }
      : {})
  };
  const [list, total] = await Promise.all([
    prisma.role.findMany({
      where,
      orderBy: [{ isSystem: "desc" }, { code: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.role.count({ where })
  ]);
  // 计算每个角色的活跃用户数
  const counts = await prisma.user.groupBy({
    by: ["roleId"],
    where: { deletedAt: null, roleId: { in: list.map((r) => r.id) } },
    _count: { _all: true }
  });
  const countMap = new Map(counts.map((c) => [c.roleId, c._count._all]));
  const enriched = list.map((r) => ({ ...r, userCount: countMap.get(r.id) ?? 0 }));
  return { list: enriched, total, page, pageSize };
}

export async function getRole(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.ROLE, ACTION.READ);
  const r = await prisma.role.findUnique({ where: { id } });
  if (!r) throw new ApiError(ERROR_CODES.NOT_FOUND, "角色不存在", 404);
  return r;
}

export type RoleCreateInput = {
  code: string;
  name: string;
  description?: string;
  permissions: { resource: string; actions: string[] }[];
};

export async function createRole(actor: SessionUser, input: RoleCreateInput) {
  requirePermission(actor.roleCode, RESOURCE.ROLE, ACTION.CREATE);
  const dup = await prisma.role.findUnique({ where: { code: input.code } });
  if (dup) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `角色代码 ${input.code} 已被使用`, 409);
  }
  const r = await prisma.role.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description || null,
      permissions: input.permissions as unknown as Prisma.InputJsonValue,
      isSystem: false
    }
  });
  await audit(prisma, {
    actorId: actor.id,
    action: "ROLE_CREATE",
    entity: "Role",
    entityId: r.id,
    after: { code: r.code, name: r.name }
  });
  return r;
}

export type RoleUpdateInput = Partial<{
  code: string;
  name: string;
  description: string | null;
  permissions: { resource: string; actions: string[] }[];
}>;

export async function updateRole(actor: SessionUser, id: string, input: RoleUpdateInput) {
  requirePermission(actor.roleCode, RESOURCE.ROLE, ACTION.UPDATE);
  const existing = await prisma.role.findUnique({ where: { id } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "角色不存在", 404);
  // 改 code 时校验唯一
  if (input.code && input.code !== existing.code) {
    const dup = await prisma.role.findUnique({ where: { code: input.code } });
    if (dup) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `角色代码 ${input.code} 已被使用`, 409);
    }
  }
  // ADMIN 角色不能把 permissions 改成空（防止锁死）
  if (existing.code === "ADMIN" && input.permissions && input.permissions.length === 0) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "ADMIN 角色不能配置空权限", 403);
  }
  const updated = await prisma.role.update({
    where: { id },
    data: {
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.permissions !== undefined
        ? { permissions: input.permissions as unknown as Prisma.InputJsonValue }
        : {})
    }
  });
  await audit(prisma, {
    actorId: actor.id,
    action: "ROLE_UPDATE",
    entity: "Role",
    entityId: id,
    before: { code: existing.code, name: existing.name },
    after: { code: updated.code, name: updated.name }
  });
  return updated;
}

export async function deleteRole(actor: SessionUser, id: string) {
  requirePermission(actor.roleCode, RESOURCE.ROLE, ACTION.DELETE);
  const existing = await prisma.role.findUnique({ where: { id } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "角色不存在", 404);
  if (existing.isSystem) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "系统角色不可删除", 403);
  }
  const userCount = await prisma.user.count({ where: { roleId: id, deletedAt: null } });
  if (userCount > 0) {
    throw new ApiError(
      ERROR_CODES.USER_HAS_ACTIVE_OWNERSHIP,
      `该角色仍有 ${userCount} 个用户,请先迁出`,
      409
    );
  }
  await prisma.role.delete({ where: { id } });
  await audit(prisma, {
    actorId: actor.id,
    action: "ROLE_DELETE",
    entity: "Role",
    entityId: id,
    before: { code: existing.code, name: existing.name }
  });
  return { ok: true };
}

/** 创建一个新自定义角色时,基于某个 system 角色的默认权限复制 */
export function defaultPermissionsFor(code: keyof typeof ROLE_PERMISSIONS) {
  return ROLE_PERMISSIONS[code] ?? [];
}
