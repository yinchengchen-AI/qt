import { z } from "zod";
import { ok, err } from "@/lib/api";
import { resolveStatsRange } from "@/lib/date-range";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { getDashboardSummary } from "@/server/services/dashboard";

const query = z.object({
  range: z.enum(["month", "quarter", "year"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const range = resolveStatsRange({
        preset: parsed.range,
        from: parsed.from,
        to: parsed.to
      });
      const summary = await getDashboardSummary(user, range);
      return ok(summary);
    } catch (e) {
      return err(e);
    }
  });
}
