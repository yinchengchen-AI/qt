// 业务人员(合同 owner)维度的账龄分布
import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getAgingByOwner } from "@/server/services/statistics";

const query = z.object({
  basis: z.enum(["issue", "due"]).optional(),
  limit: z.string().optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const limit = parsed.limit ? Number(parsed.limit) : undefined;
      const data = await getAgingByOwner(user, { basis: parsed.basis, limit });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
