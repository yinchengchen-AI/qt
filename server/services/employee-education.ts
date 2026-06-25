// 员工教育经历子表服务
// 沿用现有 employee-profile.ts 的 requirePermission / $transaction / audit 模式
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import type { EmployeeEducationCreateInput, EmployeeEducationUpdateInput } from "@/lib/validators/employee-education";
import type { EmployeeEducationDto } from "@/lib/types/employee-subtables";

function toDto(row: Record<string, unknown>): EmployeeEducationDto {
  return {
    id: String(row.id),
    profileId: String(row.profileId),
    school: String(row.school),
    major: (row.major as string | null) ?? null,
    degree: (row.degree as string | null) ?? null,
    startDate: (row.startDate as Date).toISOString(),
    endDate: row.endDate ? (row.endDate as Date).toISOString() : null,
    isFullTime: Boolean(row.isFullTime),
    remark: (row.remark as string | null) ?? null,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString()
  };
}

export async function listEmployeeEducations(actor: SessionUser, profileId: string): Promise<EmployeeEducationDto[]> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.READ);
  const profile = await prisma.employeeProfile.findFirst({ where: { id: profileId, deletedAt: null }, select: { id: true } });
  if (!profile) throw new ApiError(ERROR_CODES.NOT_FOUND, "档案不存在", 404);
  const rows = await prisma.employeeEducation.findMany({
    where: { profileId, deletedAt: null },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }]
  });
  return rows.map((r) => toDto(r as unknown as Record<string, unknown>));
}

export async function createEmployeeEducation(actor: SessionUser, input: EmployeeEducationCreateInput): Promise<EmployeeEducationDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.employeeEducation.create({ data: input });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_EDUCATION_CREATE",
      entity: "EmployeeEducation",
      entityId: created.id,
      after: { ...input }
    });
    return created;
  });
  return toDto(row as unknown as Record<string, unknown>);
}

export async function updateEmployeeEducation(actor: SessionUser, id: string, input: EmployeeEducationUpdateInput): Promise<EmployeeEducationDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.employeeEducation.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "教育经历不存在", 404);
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.employeeEducation.update({ where: { id }, data: input });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_EDUCATION_UPDATE",
      entity: "EmployeeEducation",
      entityId: id,
      before: { ...existing },
      after: { ...updated }
    });
    return updated;
  });
  return toDto(row as unknown as Record<string, unknown>);
}

export async function deleteEmployeeEducation(actor: SessionUser, id: string): Promise<void> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.employeeEducation.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "教育经历不存在", 404);
  await prisma.$transaction(async (tx) => {
    await tx.employeeEducation.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_EDUCATION_DELETE",
      entity: "EmployeeEducation",
      entityId: id,
      before: { ...existing }
    });
  });
}
