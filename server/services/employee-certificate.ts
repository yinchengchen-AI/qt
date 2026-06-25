// 员工证书子表服务（含到期日，cron 在 PR9 用）
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import type { EmployeeCertificateCreateInput, EmployeeCertificateUpdateInput } from "@/lib/validators/employee-certificate";
import type { EmployeeCertificateDto } from "@/lib/types/employee-subtables";

function toDto(row: Record<string, unknown>): EmployeeCertificateDto {
  return {
    id: String(row.id),
    profileId: String(row.profileId),
    name: String(row.name),
    number: (row.number as string | null) ?? null,
    issuer: (row.issuer as string | null) ?? null,
    issueDate: row.issueDate ? (row.issueDate as Date).toISOString() : null,
    expiryDate: row.expiryDate ? (row.expiryDate as Date).toISOString() : null,
    attachmentId: (row.attachmentId as string | null) ?? null,
    remark: (row.remark as string | null) ?? null,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString()
  };
}

export async function listEmployeeCertificates(actor: SessionUser, profileId: string): Promise<EmployeeCertificateDto[]> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.READ);
  const profile = await prisma.employeeProfile.findFirst({ where: { id: profileId, deletedAt: null }, select: { id: true } });
  if (!profile) throw new ApiError(ERROR_CODES.NOT_FOUND, "档案不存在", 404);
  const rows = await prisma.employeeCertificate.findMany({
    where: { profileId, deletedAt: null },
    orderBy: [{ expiryDate: "asc" }, { createdAt: "desc" }]
  });
  return rows.map((r) => toDto(r as unknown as Record<string, unknown>));
}

export async function createEmployeeCertificate(actor: SessionUser, input: EmployeeCertificateCreateInput): Promise<EmployeeCertificateDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.employeeCertificate.create({ data: input });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_CERTIFICATE_CREATE",
      entity: "EmployeeCertificate",
      entityId: created.id,
      after: { ...input }
    });
    return created;
  });
  return toDto(row as unknown as Record<string, unknown>);
}

export async function updateEmployeeCertificate(actor: SessionUser, id: string, input: EmployeeCertificateUpdateInput): Promise<EmployeeCertificateDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.employeeCertificate.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "证书不存在", 404);
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.employeeCertificate.update({ where: { id }, data: input });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_CERTIFICATE_UPDATE",
      entity: "EmployeeCertificate",
      entityId: id,
      before: { ...existing },
      after: { ...updated }
    });
    return updated;
  });
  return toDto(row as unknown as Record<string, unknown>);
}

export async function deleteEmployeeCertificate(actor: SessionUser, id: string): Promise<void> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const existing = await prisma.employeeCertificate.findFirst({ where: { id, deletedAt: null } });
  if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "证书不存在", 404);
  await prisma.$transaction(async (tx) => {
    await tx.employeeCertificate.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_CERTIFICATE_DELETE",
      entity: "EmployeeCertificate",
      entityId: id,
      before: { ...existing }
    });
  });
}
