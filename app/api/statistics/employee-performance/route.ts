import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getEmployeePerformance } from "@/server/services/statistics";
import { parseDateRangeQuery, defaultMonthRange } from "@/lib/date-range";
import type { DateRange } from "@/lib/date-range";

const query = z.object({
  userId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      // 无 from/to 时默认本月, 与 dashboard 一致;
      // parseDateRangeQuery 只填空 DateRange, 这里再补默认值
      const parsedRange = parseDateRangeQuery(parsed);
      const fallback = defaultMonthRange();
      const range: DateRange = {
        from: parsedRange.from ?? fallback.from,
        to: parsedRange.to ?? fallback.to
      };
      const data = await getEmployeePerformance(user, parsed.userId, range);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
