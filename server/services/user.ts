// 用户管理服务（仅 ADMIN）
// 护栏：
//   - 不能改/禁/删自己
//   - 不能改/禁/删最后一位 ACTIVE 的 ADMIN
//   - 软删：仅设 deletedAt；保留 audit 引用
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import type { Prisma } from "@prisma/client";

const PASSWORD_SALT_ROUNDS = 10;
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*";

function randomPassword(len = 10): string {
  const bytes = new Uint32Array(len);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 0xffffffff);
  }
  let out = "";
  for (let i = 0; i < len; i++) {
    const v = bytes[i] ?? 0;
    out += PASSWORD_ALPHABET[v % PASSWORD_ALPHABET.length];
  }
  return out;
}

export async function listUsers(
  user: SessionUser,
  params: {
    page: number;
    pageSize: number;
    keyword?: string;
    roleId?: string;
    status?: string;
    department?: string;
  }
) {
  requirePermission(user.roleCode, RESOURCE.USER, ACTION.READ);
  const { page, pageSize, keyword, roleId, status, department } = params;
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(roleId ? { roleId } : {}),
    ...(status ? { status } : {}),
    ...(department ? { department } : {}),
    ...(keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: "insensitive" } },
            { employeeNo: { contains: keyword, mode: "insensitive" } },
            { email: { contains: keyword, mode: "insensitive" } }
          ]
        }
      : {})
  };
  const [list, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { role: { select: { id: true, code: true, name: true } } }
    }),
    prisma.user.count({ where })
  ]);
  return { list, total, page, pageSize };
}

export async function getUser(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.USER, ACTION.READ);
  const u = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: { role: true }
  });
  if (!u) throw new ApiError(ERROR_CODES.NOT_FOUND, "用户不存在", 404);
  // 不要把 passwordHash 暴露给前端
  const { passwordHash: _omit, ...safe } = u;
  return safe;
}

async function assertNotSelfAndNotLastAdmin(actor: SessionUser, targetId: string, targetRoleCode: string) {
  if (actor.id === targetId) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "不能对自己执行此操作", 403);
  }
  if (targetRoleCode === "ADMIN") {
    const remaining = await prisma.user.count({
      where: { id: { not: targetId }, role: { code: "ADMIN" }, status: "ACTIVE", deletedAt: null }
    });
    if (remaining === 0) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "不能改/禁/删最后一位 ADMIN", 403);
    }
  }
}

export type UserCreateInput = {
  employeeNo: string;
  name: string;
  email: string;
  phone?: string;
  roleId: string;
  department?: string;
  status?: "ACTIVE" | "DISABLED";
};

export async function createUser(actor: SessionUser, input: UserCreateInput) {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.CREATE);
  const role = await prisma.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "角色不存在", 400);
  if (input.status === "DISABLED" && role.code === "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "不能直接以 DISABLED 状态创建 ADMIN", 403);
  }
  const existing = await prisma.user.findFirst({
    where: { OR: [{ employeeNo: input.employeeNo }, { email: input.email }] }
  });
  if (existing) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "工号或邮箱已被使用", 409);
  }
  const passwordHash = await bcrypt.hash("123456", PASSWORD_SALT_ROUNDS);
  const u = await prisma.user.create({
    data: {
      employeeNo: input.employeeNo,
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      roleId: input.roleId,
      department: input.department ?? null,
      status: input.status ?? "ACTIVE",
      passwordHash
    }
  });
  await audit(prisma, {
    actorId: actor.id,
    action: "USER_CREATE",
    entity: "User",
    entityId: u.id,
    after: { employeeNo: u.employeeNo, name: u.name, roleCode: role.code }
  });
  return u;
}

export type UserUpdateInput = Partial<{
  name: string;
  email: string;
  phone: string | null;
  roleId: string;
  department: string | null;
  status: "ACTIVE" | "DISABLED";
}>;

export async function updateUser(actor: SessionUser, id: string, input: UserUpdateInput) {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: { role: true } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "用户不存在", 404);
  if (input.roleId && input.roleId !== existing.roleId) {
    const newRole = await prisma.role.findUnique({ where: { id: input.roleId } });
    if (!newRole) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "角色不存在", 400);
    // 改 role 后：新 role 是 ADMIN 时，要确认改完后还有其它 ACTIVE ADMIN
    if (newRole.code === "ADMIN") {
      // 允许切换到 ADMIN，不影响剩余 ADMIN 数（原本不是 ADMIN → 新是 ADMIN，剩余 ≥ 1 不变）
    } else if (existing.role.code === "ADMIN") {
      // 从 ADMIN 改为其它：先校验剩余 ACTIVE ADMIN
      await assertNotSelfAndNotLastAdmin(actor, existing.id, "ADMIN");
    }
  }
  // 改 status 为 DISABLED：原 role 是 ADMIN 时校验
  if (input.status === "DISABLED" && existing.status !== "DISABLED") {
    await assertNotSelfAndNotLastAdmin(actor, existing.id, existing.role.code);
  }
  // 改 name/email/phone/department 都不需要护栏
  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
      ...(input.department !== undefined ? { department: input.department } : {}),
      ...(input.status !== undefined ? { status: input.status } : {})
    }
  });
  await audit(prisma, {
    actorId: actor.id,
    action: "USER_UPDATE",
    entity: "User",
    entityId: id,
    before: { name: existing.name, status: existing.status, roleId: existing.roleId },
    after: { name: updated.name, status: updated.status, roleId: updated.roleId }
  });
  return updated;
}

export async function softDeleteUser(actor: SessionUser, id: string) {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.DELETE);
  const existing = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: { role: true } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "用户不存在", 404);
  await assertNotSelfAndNotLastAdmin(actor, existing.id, existing.role.code);
  await prisma.user.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit(prisma, {
    actorId: actor.id,
    action: "USER_DELETE",
    entity: "User",
    entityId: id,
    before: { name: existing.name, employeeNo: existing.employeeNo }
  });
  return { ok: true };
}

export async function resetPassword(actor: SessionUser, id: string): Promise<{ newPassword: string }> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.user.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "用户不存在", 404);
  const newPassword = randomPassword(10);
  const passwordHash = await bcrypt.hash(newPassword, PASSWORD_SALT_ROUNDS);
  await prisma.user.update({ where: { id }, data: { passwordHash } });
  await audit(prisma, {
    actorId: actor.id,
    action: "USER_RESET_PASSWORD",
    entity: "User",
    entityId: id,
    before: { employeeNo: existing.employeeNo }
  });
  return { newPassword };
}

export async function toggleStatus(actor: SessionUser, id: string, status: "ACTIVE" | "DISABLED") {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: { role: true } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "用户不存在", 404);
  if (existing.status === status) {
    return existing; // noop
  }
  if (status === "DISABLED") {
    await assertNotSelfAndNotLastAdmin(actor, existing.id, existing.role.code);
  }
  const updated = await prisma.user.update({ where: { id }, data: { status } });
  await audit(prisma, {
    actorId: actor.id,
    action: "USER_TOGGLE_STATUS",
    entity: "User",
    entityId: id,
    before: { status: existing.status },
    after: { status: updated.status }
  });
  return updated;
}
