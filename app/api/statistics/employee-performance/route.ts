import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getEmployeePerformance } from "@/server/services/statistics";

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
      const from = parsed.from ? new Date(parsed.from) : undefined;
      const to = parsed.to ? new Date(parsed.to) : undefined;
      const data = await getEmployeePerformance(user, parsed.userId, { from, to });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
