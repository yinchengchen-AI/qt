import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getTopCustomers } from "@/server/services/statistics";

const query = z.object({
  metric: z.enum(["contract", "payment"]).default("contract"),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const { metric, limit } = query.parse(
        Object.fromEntries(url.searchParams),
      );
      const data = await getTopCustomers(user, metric, limit);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
