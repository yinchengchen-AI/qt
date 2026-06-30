// 未开票合同预警(账龄页"未开票合同"tab)
import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getUninvoicedContracts } from "@/server/services/statistics";

const query = z.object({
  thresholdDays: z.string().optional(),
  limit: z.string().optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const data = await getUninvoicedContracts(user, {
        thresholdDays: parsed.thresholdDays ? Number(parsed.thresholdDays) : undefined,
        limit: parsed.limit ? Number(parsed.limit) : undefined
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
