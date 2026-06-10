// 部门管理服务（ADMIN:全权, OPS:CRUD, 其它角色:只读）
// 护栏：
//   - 树形防环:不能把自己移到自己或自己后代下
//   - 不能删有子部门的部门（提示先迁移）
//   - 不能删有成员的部门（提示先转走）
//   - 不能把 active 部门改为 inactive 后再编辑（其实允许,业务查询会自动过滤）
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import type { Prisma } from "@prisma/client";

export async function listDepartments(
  user: SessionUser,
  params: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    parentId?: string;
    tree?: boolean;
    includeInactive?: boolean;
  }
) {
  requirePermission(user.roleCode, RESOURCE.DEPARTMENT, ACTION.READ);
  const { page = 1, pageSize = 200, keyword, parentId, tree, includeInactive } = params;

  const where: Prisma.DepartmentWhereInput = {
    ...(includeInactive ? {} : { isActive: true }),
    ...(parentId ? { parentId } : {}),
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
    prisma.department.findMany({
      where,
      orderBy: [{ sort: "asc" }, { code: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize
    }),
    prisma.department.count({ where })
  ]);

  // 算每个部门的成员数
  const counts = await prisma.user.groupBy({
    by: ["departmentId"],
    where: { departmentId: { in: list.map((d) => d.id) } },
    _count: { _all: true }
  });
  const countMap = new Map(counts.map((c) => [c.departmentId, c._count._all]));

  const enriched = list.map((d) => ({ ...d, memberCount: countMap.get(d.id) ?? 0 }));

  if (!tree) {
    return { list: enriched, total, page, pageSize };
  }

  // 构造树:按 parentId 分组,递归组装
  const byParent = new Map<string | null, typeof enriched>();
  for (const d of enriched) {
    const arr = byParent.get(d.parentId) ?? [];
    arr.push(d);
    byParent.set(d.parentId, arr);
  }
  function buildTree(parent: string | null): unknown[] {
    const nodes = byParent.get(parent) ?? [];
    return nodes.map((n) => ({
      ...n,
      children: buildTree(n.id)
    }));
  }
  return { tree: buildTree(null), total };
}

export async function getDepartment(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.DEPARTMENT, ACTION.READ);
  const d = await prisma.department.findUnique({ where: { id } });
  if (!d) throw new ApiError(ERROR_CODES.NOT_FOUND, "部门不存在", 404);
  const memberCount = await prisma.user.count({ where: { departmentId: id } });
  const childCount = await prisma.department.count({ where: { parentId: id } });
  return { ...d, memberCount, childCount };
}

export type DepartmentCreateInput = {
  code: string;
  name: string;
  parentId?: string;
  sort?: number;
};

export async function createDepartment(actor: SessionUser, input: DepartmentCreateInput) {
  requirePermission(actor.roleCode, RESOURCE.DEPARTMENT, ACTION.CREATE);
  if (input.parentId) {
    const parent = await prisma.department.findUnique({ where: { id: input.parentId } });
    if (!parent) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "上级部门不存在", 400);
  }
  const dup = await prisma.department.findUnique({ where: { code: input.code } });
  if (dup) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `部门代码 ${input.code} 已被使用`, 409);
  }
  const d = await prisma.department.create({
    data: {
      code: input.code,
      name: input.name,
      parentId: input.parentId || null,
      sort: input.sort ?? 0
    }
  });
  await audit(prisma, {
    actorId: actor.id,
    action: "DEPARTMENT_CREATE",
    entity: "Department",
    entityId: d.id,
    after: { code: d.code, name: d.name, parentId: d.parentId }
  });
  return d;
}

export type DepartmentUpdateInput = Partial<{
  code: string;
  name: string;
  parentId: string | null;
  sort: number;
  isActive: boolean;
}>;

export async function updateDepartment(actor: SessionUser, id: string, input: DepartmentUpdateInput) {
  requirePermission(actor.roleCode, RESOURCE.DEPARTMENT, ACTION.UPDATE);
  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "部门不存在", 404);

  if (input.parentId !== undefined && input.parentId !== null && input.parentId !== existing.parentId) {
    // 防环:不能把自己移到自己或自己后代下
    await assertNotDescendant(input.parentId, id);
  }
  if (input.code && input.code !== existing.code) {
    const dup = await prisma.department.findUnique({ where: { code: input.code } });
    if (dup) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `部门代码 ${input.code} 已被使用`, 409);
    }
  }
  const updated = await prisma.department.update({
    where: { id },
    data: {
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId || null } : {}),
      ...(input.sort !== undefined ? { sort: input.sort } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {})
    }
  });
  await audit(prisma, {
    actorId: actor.id,
    action: "DEPARTMENT_UPDATE",
    entity: "Department",
    entityId: id,
    before: { code: existing.code, name: existing.name, parentId: existing.parentId },
    after: { code: updated.code, name: updated.name, parentId: updated.parentId }
  });
  return updated;
}

export async function deleteDepartment(actor: SessionUser, id: string) {
  requirePermission(actor.roleCode, RESOURCE.DEPARTMENT, ACTION.DELETE);
  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "部门不存在", 404);

  const childCount = await prisma.department.count({ where: { parentId: id } });
  if (childCount > 0) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `该部门仍有 ${childCount} 个子部门,请先迁移`,
      409
    );
  }
  const memberCount = await prisma.user.count({ where: { departmentId: id } });
  if (memberCount > 0) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `该部门仍有 ${memberCount} 个成员,请先转走`,
      409
    );
  }
  await prisma.department.delete({ where: { id } });
  await audit(prisma, {
    actorId: actor.id,
    action: "DEPARTMENT_DELETE",
    entity: "Department",
    entityId: id,
    before: { code: existing.code, name: existing.name }
  });
  return { ok: true };
}

export async function moveDepartment(actor: SessionUser, id: string, parentId: string | null) {
  requirePermission(actor.roleCode, RESOURCE.DEPARTMENT, ACTION.UPDATE);
  const existing = await prisma.department.findUnique({ where: { id } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "部门不存在", 404);
  if (parentId) {
    if (parentId === id) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "不能把自己移到自己下", 400);
    }
    await assertNotDescendant(parentId, id);
  }
  const updated = await prisma.department.update({
    where: { id },
    data: { parentId: parentId || null }
  });
  await audit(prisma, {
    actorId: actor.id,
    action: "DEPARTMENT_MOVE",
    entity: "Department",
    entityId: id,
    before: { parentId: existing.parentId },
    after: { parentId: updated.parentId }
  });
  return updated;
}

/** 检查 targetId 是否是 ancestorId 的后代(防环) */
async function assertNotDescendant(targetId: string, ancestorId: string) {
  // 从 targetId 向上走,如果遇到 ancestorId,说明 ancestorId 是 targetId 的祖先
  let cur: string | null = targetId;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur)) break; // 死循环兜底
    seen.add(cur);
    if (cur === ancestorId) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        "不能把部门移到自身或自身后代下(会形成环)",
        400
      );
    }
    const node: { parentId: string | null } | null = await prisma.department.findUnique({
      where: { id: cur },
      select: { parentId: true }
    });
    cur = node?.parentId ?? null;
  }
}
