// 员工紧急联系人子表服务
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import type { EmployeeEmergencyContactCreateInput, EmployeeEmergencyContactUpdateInput } from "@/lib/validators/employee-emergency-contact";
import type { EmployeeEmergencyContactDto } from "@/lib/types/employee-subtables";

function toDto(row: Record<string, unknown>): EmployeeEmergencyContactDto {
  return {
    id: String(row.id),
    profileId: String(row.profileId),
    name: String(row.name),
    relationship: String(row.relationship),
    phone: String(row.phone),
    remark: (row.remark as string | null) ?? null,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString()
  };
}

export async function listEmployeeEmergencyContacts(actor: SessionUser, profileId: string): Promise<EmployeeEmergencyContactDto[]> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.READ);
  const profile = await prisma.employeeProfile.findFirst({ where: { id: profileId, deletedAt: null }, select: { id: true } });
  if (!profile) throw new ApiError(ERROR_CODES.NOT_FOUND, "档案不存在", 404);
  const rows = await prisma.employeeEmergencyContact.findMany({
    where: { profileId, deletedAt: null },
    orderBy: [{ createdAt: "desc" }]
  });
  return rows.map((r) => toDto(r as unknown as Record<string, unknown>));
}

export async function createEmployeeEmergencyContact(actor: SessionUser, input: EmployeeEmergencyContactCreateInput): Promise<EmployeeEmergencyContactDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.employeeEmergencyContact.create({ data: input });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_EMERGENCY_CONTACT_CREATE",
      entity: "EmployeeEmergencyContact",
      entityId: created.id,
      after: { ...input }
    });
    return created;
  });
  return toDto(row as unknown as Record<string, unknown>);
}

export async function updateEmployeeEmergencyContact(actor: SessionUser, id: string, input: EmployeeEmergencyContactUpdateInput): Promise<EmployeeEmergencyContactDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.employeeEmergencyContact.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "紧急联系人不存在", 404);
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.employeeEmergencyContact.update({ where: { id }, data: input });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_EMERGENCY_CONTACT_UPDATE",
      entity: "EmployeeEmergencyContact",
      entityId: id,
      before: { ...existing },
      after: { ...updated }
    });
    return updated;
  });
  return toDto(row as unknown as Record<string, unknown>);
}

export async function deleteEmployeeEmergencyContact(actor: SessionUser, id: string): Promise<void> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.employeeEmergencyContact.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "紧急联系人不存在", 404);
  await prisma.$transaction(async (tx) => {
    await tx.employeeEmergencyContact.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_EMERGENCY_CONTACT_DELETE",
      entity: "EmployeeEmergencyContact",
      entityId: id,
      before: { ...existing }
    });
  });
}
