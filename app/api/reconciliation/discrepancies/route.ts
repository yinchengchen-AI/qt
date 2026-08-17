import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { listDiscrepancies } from "@/server/services/reconciliation";
import { discrepancyListQuerySchema } from "@/lib/validators/reconciliation";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = discrepancyListQuerySchema.parse(Object.fromEntries(url.searchParams));
      const data = await listDiscrepancies(user, params);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
