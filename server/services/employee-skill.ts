// 员工技能子表服务
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import type { EmployeeSkillCreateInput, EmployeeSkillUpdateInput } from "@/lib/validators/employee-skill";
import type { EmployeeSkillDto } from "@/lib/types/employee-subtables";

function toDto(row: Record<string, unknown>): EmployeeSkillDto {
  return {
    id: String(row.id),
    profileId: String(row.profileId),
    name: String(row.name),
    level: String(row.level),
    obtainDate: row.obtainDate ? (row.obtainDate as Date).toISOString() : null,
    remark: (row.remark as string | null) ?? null,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString()
  };
}

export async function listEmployeeSkills(actor: SessionUser, profileId: string): Promise<EmployeeSkillDto[]> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.READ);
  const profile = await prisma.employeeProfile.findFirst({ where: { id: profileId, deletedAt: null }, select: { id: true } });
  if (!profile) throw new ApiError(ERROR_CODES.NOT_FOUND, "档案不存在", 404);
  const rows = await prisma.employeeSkill.findMany({
    where: { profileId, deletedAt: null },
    orderBy: [{ obtainDate: "desc" }, { createdAt: "desc" }]
  });
  return rows.map((r) => toDto(r as unknown as Record<string, unknown>));
}

export async function createEmployeeSkill(actor: SessionUser, input: EmployeeSkillCreateInput): Promise<EmployeeSkillDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.employeeSkill.create({ data: input });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_SKILL_CREATE",
      entity: "EmployeeSkill",
      entityId: created.id,
      after: { ...input }
    });
    return created;
  });
  return toDto(row as unknown as Record<string, unknown>);
}

export async function updateEmployeeSkill(actor: SessionUser, id: string, input: EmployeeSkillUpdateInput): Promise<EmployeeSkillDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.employeeSkill.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "技能不存在", 404);
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.employeeSkill.update({ where: { id }, data: input });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_SKILL_UPDATE",
      entity: "EmployeeSkill",
      entityId: id,
      before: { ...existing },
      after: { ...updated }
    });
    return updated;
  });
  return toDto(row as unknown as Record<string, unknown>);
}

export async function deleteEmployeeSkill(actor: SessionUser, id: string): Promise<void> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.employeeSkill.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "技能不存在", 404);
  await prisma.$transaction(async (tx) => {
    await tx.employeeSkill.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_SKILL_DELETE",
      entity: "EmployeeSkill",
      entityId: id,
      before: { ...existing }
    });
  });
}
