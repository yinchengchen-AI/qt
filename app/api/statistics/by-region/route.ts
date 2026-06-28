import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getRegionStatistics } from "@/server/services/statistics";
import { resolveDateRangeQuery } from "@/lib/date-range";

const query = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const range = resolveDateRangeQuery(parsed);
      const rows = await getRegionStatistics(user, range);
      return ok({ rows });
    } catch (e) {
      return err(e);
    }
  });
}
