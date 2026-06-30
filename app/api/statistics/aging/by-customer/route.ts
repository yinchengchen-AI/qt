// 客户维度的账龄分布(供账龄页"按客户"tab)
import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getAgingByCustomer } from "@/server/services/statistics";

const query = z.object({
  basis: z.enum(["issue", "due"]).optional(),
  limit: z.string().optional(),
  minAmount: z.string().optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const limit = parsed.limit ? Number(parsed.limit) : undefined;
      const minAmount = parsed.minAmount ? Number(parsed.minAmount) : undefined;
      const data = await getAgingByCustomer(user, {
        basis: parsed.basis,
        limit,
        minAmount
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
