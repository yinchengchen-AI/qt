import { z } from "zod";
import { employeeProfileUpdateSchema, isoDateOrDateTime } from "./employee-profile";

export const userStatus = z.enum(["ACTIVE", "DISABLED"]);

export const userCreateSchema = z.object({
  employeeNo: z.string().min(1, "工号必填").max(40),
  name: z.string().min(1, "姓名必填").max(40),
  email: z.string().email("邮箱格式错误").max(120),
  phone: z.string().max(20).optional().or(z.literal("")),
  roleId: z.string().min(1, "请选择角色"),
  departmentId: z.string().optional().or(z.literal("")),
  status: userStatus.default("ACTIVE")
});

export const userUpdateSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  email: z.string().email().max(120).optional(),
  phone: z.string().max(20).nullable().optional(),
  roleId: z.string().min(1).optional(),
  departmentId: z.string().nullable().optional(),
  status: userStatus.optional()
});

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  roleId: z.string().optional(),
  status: z.string().optional(),
  departmentId: z.string().optional()
});

export const userToggleStatusSchema = z.object({
  status: userStatus
});

// 管理员手动重置密码:8~72 字符(72 是 bcrypt 的硬上限,超出会被静默截断)
export const userResetPasswordSchema = z.object({
  password: z
    .string()
    .min(8, "密码至少 8 个字符")
    .max(72, "密码不能超过 72 个字符")
});

export const userWithProfileUpdateSchema = z.object({
  user: userUpdateSchema.optional(),
  profile: employeeProfileUpdateSchema.optional(),
  // 5 张子表(PR3 起)— 每次 PATCH 全量替换(全删全插)
  educations: z.array(z.object({
    school: z.string().min(1).max(200),
    major: z.string().max(200).optional().nullable(),
    degree: z.string().max(50).optional().nullable(),
    startDate: isoDateOrDateTime(),
    endDate: isoDateOrDateTime().optional().nullable(),
    isFullTime: z.boolean().optional(),
    remark: z.string().max(2000).optional().nullable()
  })).optional(),
  workExperiences: z.array(z.object({
    company: z.string().min(1).max(200),
    position: z.string().max(50).optional().nullable(),
    startDate: isoDateOrDateTime(),
    endDate: isoDateOrDateTime().optional().nullable(),
    leaveReason: z.string().max(200).optional().nullable(),
    referrer: z.string().max(50).optional().nullable(),
    remark: z.string().max(2000).optional().nullable()
  })).optional(),
  certificates: z.array(z.object({
    name: z.string().min(1).max(200),
    number: z.string().max(100).optional().nullable(),
    issuer: z.string().max(200).optional().nullable(),
    issueDate: isoDateOrDateTime().optional().nullable(),
    expiryDate: isoDateOrDateTime().optional().nullable(),
    attachmentId: z.string().min(1).optional().nullable(),
    remark: z.string().max(2000).optional().nullable()
  })).optional(),
  skills: z.array(z.object({
    name: z.string().min(1).max(100),
    level: z.enum(["BEGINNER", "INTERMEDIATE", "ADVANCED"]).default("INTERMEDIATE"),
    obtainDate: isoDateOrDateTime().optional().nullable(),
    remark: z.string().max(2000).optional().nullable()
  })).optional(),
  emergencyContacts: z.array(z.object({
    name: z.string().min(1).max(50),
    relationship: z.enum(["父母", "配偶", "兄弟姐妹", "子女", "其他"]),
    phone: z.string().regex(/^1[3-9]\d{9}$/),
    remark: z.string().max(500).optional().nullable()
  })).optional(),
  // 并发检测(PR3):客户端上次 GET 拿到的 updatedAt
  expectedUpdatedAt: z.string().optional()
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserResetPasswordInput = z.infer<typeof userResetPasswordSchema>;
export type UserWithProfileUpdateInput = z.infer<typeof userWithProfileUpdateSchema>;
