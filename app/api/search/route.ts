import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { globalSearch } from "@/server/services/search";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const q = url.searchParams.get("q") ?? "";
      if (q.trim().length < 2) {
        return ok({ customers: [], contracts: [], invoices: [], payments: [] });
      }
      const data = await globalSearch(user, q);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
