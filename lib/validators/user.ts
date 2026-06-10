import { z } from "zod";

export const userStatus = z.enum(["ACTIVE", "DISABLED"]);

export const userCreateSchema = z.object({
  employeeNo: z.string().min(1, "工号必填").max(40),
  name: z.string().min(1, "姓名必填").max(40),
  email: z.string().email("邮箱格式错误").max(120),
  phone: z.string().max(20).optional().or(z.literal("")),
  roleId: z.string().min(1, "请选择角色"),
  department: z.string().max(40).optional().or(z.literal("")),
  status: userStatus.default("ACTIVE")
});

export const userUpdateSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  email: z.string().email().max(120).optional(),
  phone: z.string().max(20).nullable().optional(),
  roleId: z.string().min(1).optional(),
  department: z.string().max(40).nullable().optional(),
  status: userStatus.optional()
});

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  roleId: z.string().optional(),
  status: z.string().optional(),
  department: z.string().optional()
});

export const userToggleStatusSchema = z.object({
  status: userStatus
});

export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
