import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getOverview, getCustomerDistribution, getInvoiceAging } from "@/server/services/statistics";

const query = z.object({ from: z.string().optional(), to: z.string().optional() });

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const parsed = query.parse(Object.fromEntries(url.searchParams));
    const from = parsed.from ? new Date(parsed.from) : undefined;
    const to = parsed.to ? new Date(parsed.to) : undefined;
    const [overview, distribution, aging] = await Promise.all([
      getOverview(user, { from, to }),
      getCustomerDistribution(user),
      getInvoiceAging(user)
    ]);
    return ok({ overview, distribution, agingBuckets: aging.buckets });
  } catch (e) {
    return err(e);
  }
}
