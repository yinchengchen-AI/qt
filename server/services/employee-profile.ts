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

// ============================================================================
// PR3: 全量档案读写 (含 5 张子表 + 头像 + 409 并发检测)
// ============================================================================

import { listEmployeeEducations } from "./employee-education";
import { listEmployeeWorkExperiences } from "./employee-work-experience";
import { listEmployeeCertificates } from "./employee-certificate";
import { listEmployeeSkills } from "./employee-skill";
import { listEmployeeEmergencyContacts } from "./employee-emergency-contact";
import type { FullEmployeeProfileDto } from "@/lib/types/employee-profile";

export async function getUserFullProfile(actor: SessionUser, userId: string): Promise<FullEmployeeProfileDto | null> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.READ);
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: {
      profile: {
        include: {
          avatarAttachment: { where: { deletedAt: null } },
          attachments: { where: { deletedAt: null, category: { in: ["GENERAL", "ID_CARD_FRONT", "ID_CARD_BACK"] } } }
        }
      }
    }
  });
  if (!user?.profile) return null;

  const profile = decryptProfile(user.profile as unknown as Record<string, unknown>);
  if (!hasPermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE)) {
    // 非 ADMIN 过滤敏感字段
    profile.salary = null;
    profile.bankAccount = null;
    profile.bankName = null;
    profile.socialSecurityAccount = null;
    profile.providentFundAccount = null;
  }

  const [educations, workExperiences, certificates, skills, emergencyContacts] = await Promise.all([
    listEmployeeEducations(actor, user.profile.id),
    listEmployeeWorkExperiences(actor, user.profile.id),
    listEmployeeCertificates(actor, user.profile.id),
    listEmployeeSkills(actor, user.profile.id),
    listEmployeeEmergencyContacts(actor, user.profile.id)
  ]);

  return {
    profile,
    educations,
    workExperiences,
    certificates,
    skills,
    emergencyContacts,
    avatar: user.profile.avatarAttachment ? {
      id: user.profile.avatarAttachment.id,
      name: user.profile.avatarAttachment.originalName,
      mimeType: user.profile.avatarAttachment.mimeType,
      size: user.profile.avatarAttachment.size
    } : null
  };
}

export type UserFullProfileUpdateInput = {
  user?: Record<string, unknown>;
  profile?: EmployeeProfileUpdateInput;
  educations?: Array<{ school: string; major?: string | null; degree?: string | null; startDate: string; endDate?: string | null; isFullTime?: boolean; remark?: string | null }>;
  workExperiences?: Array<{ company: string; position?: string | null; startDate: string; endDate?: string | null; leaveReason?: string | null; referrer?: string | null; remark?: string | null }>;
  certificates?: Array<{ name: string; number?: string | null; issuer?: string | null; issueDate?: string | null; expiryDate?: string | null; attachmentId?: string | null; remark?: string | null }>;
  skills?: Array<{ name: string; level?: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"; obtainDate?: string | null; remark?: string | null }>;
  emergencyContacts?: Array<{ name: string; relationship: string; phone: string; remark?: string | null }>;
  expectedUpdatedAt?: string;
};

export async function updateUserFullProfile(
  actor: SessionUser,
  userId: string,
  input: UserFullProfileUpdateInput
): Promise<FullEmployeeProfileDto> {
  requirePermission(actor.roleCode, RESOURCE.USER, ACTION.UPDATE);

  // 1. 找 user + profile(可能没有)
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    include: { profile: true }
  });
  if (!user) throw new ApiError(ERROR_CODES.NOT_FOUND, "用户不存在", 404);
  if (!user.profile) throw new ApiError(ERROR_CODES.NOT_FOUND, "档案不存在,请先创建账号并补充档案", 404);

  // 2. 并发检测(409)
  if (input.expectedUpdatedAt) {
    const expected = new Date(input.expectedUpdatedAt).getTime();
    const actual = user.profile.updatedAt.getTime();
    if (Math.abs(expected - actual) > 1) {
      throw new ApiError(ERROR_CODES.CONFLICT, "档案已被他人修改,请刷新后再试", 409);
    }
  }

  // 3. 事务:更新 user 字段 + profile 字段 + 全删全插 5 张子表
  const profileData = input.profile
    ? buildProfileUpdateData({
        ...input.profile,
        birthday: input.profile.birthday ? new Date(input.profile.birthday) : undefined,
        entryDate: input.profile.entryDate ? new Date(input.profile.entryDate) : undefined,
        probationEndDate: input.profile.probationEndDate ? new Date(input.profile.probationEndDate) : undefined,
        formalDate: input.profile.formalDate ? new Date(input.profile.formalDate) : undefined,
        resignationDate: input.profile.resignationDate ? new Date(input.profile.resignationDate) : undefined,
        contractStartDate: input.profile.contractStartDate ? new Date(input.profile.contractStartDate) : undefined,
        contractEndDate: input.profile.contractEndDate ? new Date(input.profile.contractEndDate) : undefined
      } as EmployeeProfileUpdateInput)
    : {};

  const profileId = user.profile.id;
  await prisma.$transaction(async (tx) => {
    // user 字段更新
    if (input.user && Object.keys(input.user).length > 0) {
      await tx.user.update({ where: { id: userId }, data: input.user });
    }
    // profile 字段更新
    if (Object.keys(profileData).length > 0) {
      await tx.employeeProfile.update({ where: { id: profileId }, data: profileData });
    }
    // 5 张子表全删全插(只有 payload 里有这个 key 才动)
    if (input.educations !== undefined) {
      await tx.employeeEducation.deleteMany({ where: { profileId: profileId } });
      if (input.educations.length > 0) {
        await tx.employeeEducation.createMany({
          data: input.educations.map((e) => ({
            profileId: profileId,
            school: e.school,
            major: e.major ?? null,
            degree: e.degree ?? null,
            startDate: new Date(e.startDate),
            endDate: e.endDate ? new Date(e.endDate) : null,
            isFullTime: e.isFullTime ?? true,
            remark: e.remark ?? null
          }))
        });
      }
    }
    if (input.workExperiences !== undefined) {
      await tx.employeeWorkExperience.deleteMany({ where: { profileId: profileId } });
      if (input.workExperiences.length > 0) {
        await tx.employeeWorkExperience.createMany({
          data: input.workExperiences.map((w) => ({
            profileId: profileId,
            company: w.company,
            position: w.position ?? null,
            startDate: new Date(w.startDate),
            endDate: w.endDate ? new Date(w.endDate) : null,
            leaveReason: w.leaveReason ?? null,
            referrer: w.referrer ?? null,
            remark: w.remark ?? null
          }))
        });
      }
    }
    if (input.certificates !== undefined) {
      await tx.employeeCertificate.deleteMany({ where: { profileId: profileId } });
      if (input.certificates.length > 0) {
        await tx.employeeCertificate.createMany({
          data: input.certificates.map((c) => ({
            profileId: profileId,
            name: c.name,
            number: c.number ?? null,
            issuer: c.issuer ?? null,
            issueDate: c.issueDate ? new Date(c.issueDate) : null,
            expiryDate: c.expiryDate ? new Date(c.expiryDate) : null,
            attachmentId: c.attachmentId ?? null,
            remark: c.remark ?? null
          }))
        });
      }
    }
    if (input.skills !== undefined) {
      await tx.employeeSkill.deleteMany({ where: { profileId: profileId } });
      if (input.skills.length > 0) {
        await tx.employeeSkill.createMany({
          data: input.skills.map((s) => ({
            profileId: profileId,
            name: s.name,
            level: s.level ?? "INTERMEDIATE",
            obtainDate: s.obtainDate ? new Date(s.obtainDate) : null,
            remark: s.remark ?? null
          }))
        });
      }
    }
    if (input.emergencyContacts !== undefined) {
      await tx.employeeEmergencyContact.deleteMany({ where: { profileId: profileId } });
      if (input.emergencyContacts.length > 0) {
        await tx.employeeEmergencyContact.createMany({
          data: input.emergencyContacts.map((c) => ({
            profileId: profileId,
            name: c.name,
            relationship: c.relationship,
            phone: c.phone,
            remark: c.remark ?? null
          }))
        });
      }
    }
    // 审计
    await audit(tx, {
      actorId: actor.id,
      action: "EMPLOYEE_PROFILE_REPLACE",
      entity: "EmployeeProfile",
      entityId: profileId,
      before: { updatedAt: user.profile!.updatedAt },
      after: { updatedAt: new Date() }
    });
  });

  return (await getUserFullProfile(actor, userId))!;
}
