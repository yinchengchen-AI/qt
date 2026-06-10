import { z } from "zod";

export const departmentCreateSchema = z.object({
  code: z
    .string()
    .min(1, "代码必填")
    .max(30, "代码 ≤ 30 字符")
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/, "代码:字母开头,允许字母/数字/-/_"),
  name: z.string().min(1, "名称必填").max(50, "名称 ≤ 50 字符"),
  parentId: z.string().min(1).optional().or(z.literal("")),
  sort: z.number().int().min(0).max(9999).default(0)
});

export const departmentUpdateSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(30)
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
    .optional(),
  name: z.string().min(1).max(50).optional(),
  parentId: z.string().nullable().optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional()
});

export const departmentListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
  keyword: z.string().optional(),
  parentId: z.string().optional(),
  /** tree=true 时返回层级结构而非平铺列表 */
  tree: z.coerce.boolean().default(false),
  includeInactive: z.coerce.boolean().default(false)
});

export const departmentMoveSchema = z.object({
  parentId: z.string().nullable()
});

export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;
export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;
export type DepartmentMoveInput = z.infer<typeof departmentMoveSchema>;
