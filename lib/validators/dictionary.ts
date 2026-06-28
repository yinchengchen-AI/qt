import { z } from "zod";
import { ALLOWED_DICTIONARY_CATEGORIES } from "@/lib/dictionary-categories";

export const dictCategoryEnum = z.enum(ALLOWED_DICTIONARY_CATEGORIES);

export const dictCreateSchema = z.object({
  category: dictCategoryEnum,
  code: z.string().min(1, "代码必填").max(40).regex(/^[A-Z][A-Z0-9_]*$/, "代码需大写字母/数字/下划线,以大写字母开头"),
  label: z.string().min(1, "标签必填").max(80),
  // 可选父级 code:用于树形字典 (如 REGION)
  // null/未传 表示顶级;同 category 内引用,跨 category 非法
  parentCode: z.string().min(1).max(40).nullable().optional(),
  sort: z.number().int().min(0).max(9999).default(0)
});

export const dictUpdateSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  sort: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional()
});

export const dictListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
  category: z.string().optional(),
  includeInactive: z.coerce.boolean().default(false),
  keyword: z.string().optional()
});

export const dictReorderSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1),
        sort: z.number().int().min(0).max(9999)
      })
    )
    .min(1)
});

export type DictCreateInput = z.infer<typeof dictCreateSchema>;
export type DictUpdateInput = z.infer<typeof dictUpdateSchema>;
