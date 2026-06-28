// 员工工作经历子表服务
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import type { EmployeeWorkExperienceCreateInput, EmployeeWorkExperienceUpdateInput } from "@/lib/validators/employee-work-experience";
import type { EmployeeWorkExperienceDto } from "@/lib/types/employee-subtables";

function toDto(row: Record<string, unknown>): EmployeeWorkExperienceDto {
  return {
    id: String(row.id),
    profileId: String(row.profileId),
    company: String(row.company),
    position: (row.position as string | null) ?? null,
    startDate: (row.startDate as Date).toISOString(),
    endDate: row.endDate ? (row.endDate as Date).toISOString() : null,
    leaveReason: (row.leaveReason as string | null) ?? null,
    referrer: (row.referrer as string | null) ?? null,
    remark: (row.remark as string | null) ?? null,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString()
  };
}

export async function listEmployeeWorkExperiences(actor: SessionUser, profileId: string): Promise<EmployeeWorkExperienceDto[]> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.READ);
  const profile = await prisma.employeeProfile.findFirst({ where: { id: profileId, deletedAt: null }, select: { id: true } });
  if (!profile) throw new ApiError(ERROR_CODES.NOT_FOUND, "档案不存在", 404);
  const rows = await prisma.employeeWorkExperience.findMany({
    where: { profileId, deletedAt: null },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }]
  });
  return rows.map((r) => toDto(r as unknown as Record<string, unknown>));
}

export async function createEmployeeWorkExperience(actor: SessionUser, input: EmployeeWorkExperienceCreateInput): Promise<EmployeeWorkExperienceDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.employeeWorkExperience.create({ data: input });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_WORK_EXPERIENCE_CREATE",
      entity: "EmployeeWorkExperience",
      entityId: created.id,
      after: { ...input }
    });
    return created;
  });
  return toDto(row as unknown as Record<string, unknown>);
}

export async function updateEmployeeWorkExperience(actor: SessionUser, id: string, input: EmployeeWorkExperienceUpdateInput): Promise<EmployeeWorkExperienceDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.employeeWorkExperience.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "工作经历不存在", 404);
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.employeeWorkExperience.update({ where: { id }, data: input });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_WORK_EXPERIENCE_UPDATE",
      entity: "EmployeeWorkExperience",
      entityId: id,
      before: { ...existing },
      after: { ...updated }
    });
    return updated;
  });
  return toDto(row as unknown as Record<string, unknown>);
}

export async function deleteEmployeeWorkExperience(actor: SessionUser, id: string): Promise<void> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.employeeWorkExperience.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "工作经历不存在", 404);
  await prisma.$transaction(async (tx) => {
    await tx.employeeWorkExperience.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_WORK_EXPERIENCE_DELETE",
      entity: "EmployeeWorkExperience",
      entityId: id,
      before: { ...existing }
    });
  });
}
