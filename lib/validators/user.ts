import { z } from "zod";
import { employeeProfileUpdateSchema } from "./employee-profile";

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
  attachmentIds: z.array(z.string()).optional()
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
export type UserResetPasswordInput = z.infer<typeof userResetPasswordSchema>;
export type UserWithProfileUpdateInput = z.infer<typeof userWithProfileUpdateSchema>;
