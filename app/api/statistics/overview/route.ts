import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getOverview, getTimeSeries } from "@/server/services/statistics";

const query = z.object({ from: z.string().optional(), to: z.string().optional() });

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const parsed = query.parse(Object.fromEntries(url.searchParams));
    const from = parsed.from ? new Date(parsed.from) : undefined;
    const to = parsed.to ? new Date(parsed.to) : undefined;
    const [overview, series] = await Promise.all([
      getOverview(user, { from, to }),
      getTimeSeries(user, { from, to })
    ]);
    return ok({ overview, series });
  } catch (e) {
    return err(e);
  }
}
