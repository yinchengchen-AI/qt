import { z } from "zod";
import { err, ok } from "@/lib/api";
import { resolveStatsRange } from "@/lib/date-range";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { generateBusinessReport } from "@/server/services/ai-report-generation";
import { collectBusinessReportData } from "@/server/services/business-report-data";

const query = z.object({
  range: z.enum(["month", "quarter", "year"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  force: z.enum(["1"]).optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const parsed = query.parse(Object.fromEntries(new URL(req.url).searchParams));
      const range = resolveStatsRange({ preset: parsed.range, from: parsed.from, to: parsed.to });
      const data = await collectBusinessReportData(user, range);
      const report = await generateBusinessReport(data, {
        userId: user.id,
        cacheScope: `${user.id}:${user.roleCode}`,
        force: parsed.force === "1"
      });
      return ok(report);
    } catch (e) {
      return err(e);
    }
  });
}
