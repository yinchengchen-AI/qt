// 账龄趋势(近 N 天,in-memory 重算)
import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getAgingTrend } from "@/server/services/statistics";

const query = z.object({
  days: z.string().optional(),
  basis: z.enum(["issue", "due"]).optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const data = await getAgingTrend(user, {
        days: parsed.days ? Number(parsed.days) : undefined,
        basis: parsed.basis
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
