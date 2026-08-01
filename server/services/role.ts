// 角色管理服务（仅 ADMIN）
// 真源 (since v0.18.3): DB Role.permissions. admin 可在 /admin/roles 直接调整.
//   - updateRole 允许改任意角色的 permissions / code / name / description (含系统角色)
//   - 安全护栏:
//       * permissions 不能为空
//       * ADMIN 角色的 permissions 必须保留 RESOURCE.ROLE 的 READ+UPDATE, 否则后续无人能调回
//   - 权限改动后让全员在 ≤2s 内生效:
//       a) bump 所有该角色活跃用户的 User.roleVersion
//       b) invalidateAuthCache(uid) 清掉 2s 内的 userCache
//       c) invalidateRolePermCache(roleCode) + setRuntimePermissions 让本进程立即生效
//   - createRole 一律 403 (本次范围仅放权 "调整现有角色权限", 自定义角色另行单独做)
//   - 系统角色不可删; 历史遗留自定义角色可删 (清理入口)
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import {
  requirePermission,
  setRuntimePermissions,
  clearRuntimePermissions,
  RESOURCE,
  ACTION,
  ROLE_PERMISSIONS,
  type Permission
} from "@/lib/permissions";
import { invalidateAuthCache, invalidateRolePermCache } from "@/lib/auth";
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

export async function createRole(actor: SessionUser, _input: RoleCreateInput) {
  requirePermission(actor.roleCode, RESOURCE.ROLE, ACTION.CREATE);
  throw new ApiError(
    ERROR_CODES.FORBIDDEN,
    "自定义角色已停用：内置角色权限由代码矩阵 (lib/permissions.ts) 起步, admin 可在 /admin/roles 直接调整现有角色; 如确需自定义角色请另起需求",
    403
  );
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

  // ---- 安全护栏 ----
  // 1) permissions 不能为空
  if (input.permissions !== undefined && input.permissions.length === 0) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "权限不能为空, 至少配置 1 个资源", 400);
  }
  // 2) ADMIN 角色必须保留 RESOURCE.ROLE 的 READ+UPDATE, 否则后续无人能调回 (锁死护栏)
  if (existing.code === "ADMIN" && input.permissions !== undefined) {
    const rolePerm = input.permissions.find((p) => p.resource === RESOURCE.ROLE);
    const hasRead = !!rolePerm && rolePerm.actions.includes(ACTION.READ);
    const hasUpdate = !!rolePerm && rolePerm.actions.includes(ACTION.UPDATE);
    if (!hasRead || !hasUpdate) {
      throw new ApiError(
        ERROR_CODES.FORBIDDEN,
        "ADMIN 角色必须保留 [角色] 资源的读+改权限, 否则后续无人能调回 (锁死护栏)",
        403
      );
    }
  }
  // 3) 改 code 时校验唯一; 系统角色的 code 只能改成 RoleCode 联合里的值 (避免运行时崩)
  if (input.code && input.code !== existing.code) {
    const dup = await prisma.role.findUnique({ where: { code: input.code } });
    if (dup) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `角色代码 ${input.code} 已被使用`, 409);
    }
    if (existing.isSystem && !isKnownRoleCode(input.code)) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `系统角色代码必须是 ${Object.keys(ROLE_PERMISSIONS).join("/")} 之一`,
        400
      );
    }
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

  // ---- 权限/code 改动后让全员在 ≤2s 内生效 ----
  const permsChanged =
    input.permissions !== undefined &&
    !permissionsEqual(existing.permissions as unknown as Permission[], input.permissions as unknown as Permission[]);
  const codeChanged = input.code !== undefined && input.code !== existing.code;
  if (permsChanged || codeChanged) {
    const affected = await prisma.user.findMany({
      where: { roleId: id, deletedAt: null, isSystem: false },
      select: { id: true }
    });
    if (affected.length > 0) {
      await prisma.user.updateMany({
        where: { id: { in: affected.map((u) => u.id) } },
        data: { roleVersion: { increment: 1 } }
      });
      for (const u of affected) invalidateAuthCache(u.id);
    }
    // 本进程立即生效: 清掉旧 code 的 cache, 给新 code 灌新权限
    invalidateRolePermCache(existing.code);
    if (codeChanged) invalidateRolePermCache(updated.code);
    setRuntimePermissions(updated.code, updated.permissions as unknown as Permission[]);
  }

  await audit(prisma, {
    actorId: actor.id,
    action: "ROLE_UPDATE",
    entity: "Role",
    entityId: id,
    before: {
      code: existing.code,
      name: existing.name,
      permissionsCount: (existing.permissions as unknown as Permission[]).length
    },
    after: {
      code: updated.code,
      name: updated.name,
      permissionsCount: (updated.permissions as unknown as Permission[]).length
    }
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
  // 清掉本进程 runtime cache + rolePermCache, 避免残余权限被后续请求看到
  clearRuntimePermissions(existing.code);
  invalidateRolePermCache(existing.code);
  await audit(prisma, {
    actorId: actor.id,
    action: "ROLE_DELETE",
    entity: "Role",
    entityId: id,
    before: { code: existing.code, name: existing.name }
  });
  return { ok: true };
}

/** 比较两个权限数组是否等价 (顺序无关), 用于判断 updateRole 是否真改了权限 */
function permissionsEqual(a: Permission[], b: Permission[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (arr: Permission[]) =>
    new Map(arr.map((p) => [p.resource, [...p.actions].sort()]) as Array<[string, string[]]>);
  const ma = norm(a);
  const mb = norm(b);
  for (const [k, v] of ma) {
    const other = mb.get(k);
    if (!other || other.length !== v.length) return false;
    for (let i = 0; i < v.length; i++) if (other[i] !== v[i]) return false;
  }
  return true;
}

/** code 是否在 RoleCode 联合类型里 — 用于限制 system role 的 code 重命名 */
function isKnownRoleCode(code: string): code is keyof typeof ROLE_PERMISSIONS {
  return code in ROLE_PERMISSIONS;
}

/** 创建一个新自定义角色时,基于某个 system 角色的默认权限复制 (本次 createRole 仍 403, 留作接口备用) */
export function defaultPermissionsFor(code: keyof typeof ROLE_PERMISSIONS) {
  return ROLE_PERMISSIONS[code] ?? [];
}
