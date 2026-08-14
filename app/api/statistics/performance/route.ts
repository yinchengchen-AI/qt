import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getPerformanceRanking } from "@/server/services/statistics";
import { resolveStatsRange } from "@/lib/date-range";

// 统一业绩排行:owner / signer / region 三维度,支持 preset 快捷区间 (month/quarter/year)
const query = z.object({
  dimension: z.enum(["owner", "signer", "region"]).default("owner"),
  preset: z.enum(["month", "quarter", "year"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const range = resolveStatsRange(parsed);
      const rows = await getPerformanceRanking(user, parsed.dimension, range, parsed.limit);
      return ok({ rows, range });
    } catch (e) {
      return err(e);
    }
  });
}
