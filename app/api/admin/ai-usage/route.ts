// AI 用量统计查询 (仅 ADMIN) —— 薄壳, 业务逻辑在 server/services/ai-usage.ts
// 支持过滤: feature / userKeyword(姓名/工号) / status / cacheHit / 时间范围
// 返回: 分页 list + summary 汇总 (总调用 / 缓存命中率 / token 合计 / 估算成本 / 失败数 / 平均耗时)
import { z } from "zod";
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { listAiUsageLogs } from "@/server/services/ai-usage";

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  feature: z.string().optional(),
  status: z.enum(["SUCCESS", "FAILURE"]).optional(),
  cacheHit: z.enum(["true", "false"]).optional(),
  // 姓名/工号模糊匹配
  userKeyword: z.string().trim().min(1).max(50).optional(),
  // 时间范围筛选(对应 `createdAt` 字段)
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const p = query.parse(Object.fromEntries(url.searchParams));
      const { from: fromRaw, to: toRaw, cacheHit, ...rest } = p;
      const from = fromRaw ? new Date(fromRaw) : undefined;
      const to = toRaw ? new Date(toRaw) : undefined;
      const result = await listAiUsageLogs(user, {
        ...rest,
        ...(cacheHit === undefined ? {} : { cacheHit: cacheHit === "true" }),
        ...(from && !Number.isNaN(from.getTime()) ? { from } : {}),
        ...(to && !Number.isNaN(to.getTime()) ? { to } : {}),
      });
      return ok(result);
    } catch (e) {
      return err(e);
    }
  });
}
