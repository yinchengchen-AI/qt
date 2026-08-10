import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { searchAll } from "@/server/services/search";
import { searchQuerySchema } from "@/lib/validators/search";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const { q } = searchQuerySchema.parse({ q: url.searchParams.get("q") ?? "" });
      const data = await searchAll(user, q);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
