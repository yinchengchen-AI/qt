import { z } from "zod";
import { RESOURCE, ACTION } from "@/lib/permissions";

const resourceEnum = z.enum(Object.values(RESOURCE) as [string, ...string[]]);
const actionEnum = z.enum(Object.values(ACTION) as [string, ...string[]]);

export const permissionSchema = z.object({
  resource: resourceEnum,
  actions: z.array(actionEnum).min(1, "每个资源至少 1 个 action")
});

export const permissionsSchema = z.array(permissionSchema);

export const roleCreateSchema = z.object({
  code: z
    .string()
    .min(2, "代码至少 2 个字符")
    .max(40)
    .regex(/^[A-Z][A-Z0-9_]*$/, "代码需大写字母/数字/下划线,以大写字母开头"),
  name: z.string().min(1, "名称必填").max(40),
  description: z.string().max(200).optional().or(z.literal("")),
  permissions: permissionsSchema.min(1, "至少配置 1 个资源")
});

export const roleUpdateSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .optional(),
  name: z.string().min(1).max(40).optional(),
  description: z.string().max(200).nullable().optional(),
  permissions: permissionsSchema.optional()
});

export const roleListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(100),
  keyword: z.string().optional()
});

export type RoleCreateInput = z.infer<typeof roleCreateSchema>;
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;
