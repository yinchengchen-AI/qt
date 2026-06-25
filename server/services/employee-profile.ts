// 员工档案服务
// - 与 User 一对一；不存在时自动创建
// - 敏感字段（身份证、银行卡、社保/公积金账号）写入前加密，读取时解密
// - 非 ADMIN 角色读取时过滤掉敏感字段
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, hasPermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import { encrypt, decrypt } from "@/lib/encryption";
import type { EmployeeProfileUpdateInput } from "@/lib/validators/employee-profile";
import type { EmployeeProfileDto } from "@/lib/types/employee-profile";

export const ENCRYPTED_FIELDS = ["idCard", "bankAccount", "socialSecurityAccount", "providentFundAccount"] as const;

// 非 ADMIN 不可见的字段
const ADMIN_ONLY_FIELDS = new Set([
  "idCard",
  "salary",
  "bankAccount",
  "bankName",
  "socialSecurityAccount",
  "providentFundAccount"
]);

function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

function formatAttachments(value: unknown): EmployeeProfileDto["attachments"] {
  if (!Array.isArray(value)) return [];
  return value.map((a) => ({
    id: String((a as Record<string, unknown>).id ?? ""),
    name: String((a as Record<string, unknown>).originalName ?? (a as Record<string, unknown>).name ?? ""),
    mimeType: String((a as Record<string, unknown>).mimeType ?? ""),
    size: Number((a as Record<string, unknown>).size ?? 0),
    uploadedAt: toIsoString((a as Record<string, unknown>).uploadedAt) ?? ""
  })).filter((a) => a.id);
}

export function decryptProfile(profile: Record<string, unknown>): EmployeeProfileDto {
  const out = { ...profile } as unknown as Record<string, unknown>;
  for (const key of ENCRYPTED_FIELDS) {
    const val = profile[key];
    if (typeof val === "string" && val.length > 0) {
      out[key] = decrypt(val);
    }
  }
  // Prisma Decimal / Date 字段转为前端可用类型
  if (out.salary != null && typeof out.salary === "object" && "toNumber" in (out.salary as Record<string, unknown>)) {
    out.salary = (out.salary as { toNumber: () => number }).toNumber();
  }
  const dateFields = [
    "birthday", "entryDate", "probationEndDate", "formalDate", "resignationDate",
    "contractStartDate", "contractEndDate", "createdAt", "updatedAt"
  ] as const;
  for (const key of dateFields) {
    out[key] = toIsoString(out[key]);
  }
  out.attachments = formatAttachments(out.attachments);
  return out as EmployeeProfileDto;
}

export async function linkAttachmentsToProfile(
  tx: Prisma.TransactionClient,
  profileId: string,
  attachmentIds: string[]
): Promise<void> {
  if (!attachmentIds.length) return;
  await tx.attachment.updateMany({
    where: { id: { in: attachmentIds }, deletedAt: null },
    data: { employeeProfileId: profileId }
  });
}

// 临时安全网 (PR1 only): 用 Prisma 生成的字段枚举做白名单,
// 防止旧前端提交已删字段 (workExperience / educationHistory / certificates /
// emergencyContactName / emergencyContactPhone / address) 走到 Prisma 时报
// "Unknown argument" 错误。PR3 清理 validator/DTO 后移除此 allowlist。
const EMPLOYEE_PROFILE_WRITABLE_FIELDS = new Set<string>(
  Object.values(Prisma.EmployeeProfileScalarFieldEnum).filter(
    (f) => !["id", "userId", "createdAt", "updatedAt", "deletedAt"].includes(f)
  )
);

export function buildProfileUpdateData(input: EmployeeProfileUpdateInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (!EMPLOYEE_PROFILE_WRITABLE_FIELDS.has(key)) continue; // 临时 allowlist
    if (ENCRYPTED_FIELDS.includes(key as (typeof ENCRYPTED_FIELDS)[number]) && typeof value === "string" && value.length > 0) {
      data[key] = encrypt(value);
    } else {
      data[key] = value;
    }
  }
  return data;
}

export function redactForAudit(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  for (const key of ENCRYPTED_FIELDS) {
    if (out[key] != null) out[key] = "***REDACTED***";
  }
  if (out.salary != null) out.salary = "***REDACTED***";
  return out;
}

function stripAdminOnlyFields(profile: EmployeeProfileDto): EmployeeProfileDto {
  const out = { ...profile };
  for (const key of ADMIN_ONLY_FIELDS) {
    (out as Record<string, unknown>)[key] = null;
  }
  return out;
}

export async function getEmployeeProfile(actor: SessionUser, userId: string): Promise<EmployeeProfileDto | null> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.READ);
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: {
      profile: {
        include: {
          attachments: {
            where: { deletedAt: null },
            orderBy: { uploadedAt: "desc" }
          }
        }
      }
    }
  });
  if (!user) throw new ApiError(ERROR_CODES.NOT_FOUND, "用户不存在", 404);
  if (!user.profile) return null;

  const decrypted = decryptProfile(user.profile as unknown as Record<string, unknown>);
  if (!hasPermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE)) {
    return stripAdminOnlyFields(decrypted);
  }
  return decrypted;
}

export async function updateEmployeeProfile(
  actor: SessionUser,
  userId: string,
  input: EmployeeProfileUpdateInput
): Promise<EmployeeProfileDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: { profile: true }
  });
  if (!user) throw new ApiError(ERROR_CODES.NOT_FOUND, "用户不存在", 404);

  const data = buildProfileUpdateData(input);

  const profile = await prisma.$transaction(async (tx) => {
    const upserted = await tx.employeeProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data
    });
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_PROFILE_UPDATE",
      entity: "EmployeeProfile",
      entityId: upserted.id,
      before: user.profile ? Object.fromEntries(Object.keys(data).map((k) => [k, (user.profile as unknown as Record<string, unknown>)[k] ?? null])) : null,
      after: redactForAudit(data)
    });
    return upserted;
  });

  return decryptProfile(profile as unknown as Record<string, unknown>);
}
