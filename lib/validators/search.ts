import { z } from "zod";

// 全局搜索关键字: trim 后至少 1 字符; 超长截断到 50(不报错, 避免暴力输入直接 400)
export const searchQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .min(1, "请输入搜索关键字")
    .transform((s) => s.slice(0, 50))
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
