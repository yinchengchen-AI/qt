import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getTopCustomers } from "@/server/services/statistics";
import { parseDateRangeQuery } from "@/lib/date-range";

const query = z.object({
  metric: z.enum(["contract", "payment"]).default("contract"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  from: z.string().optional(),
  to: z.string().optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const range = parseDateRangeQuery(parsed);
      const data = await getTopCustomers(user, parsed.metric, parsed.limit, range);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
