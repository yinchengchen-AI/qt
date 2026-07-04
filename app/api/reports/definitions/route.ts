import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listDefinitions } from "@/server/services/report";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const defs = await listDefinitions(user);
      return ok(defs);
    } catch (e) {
      return err(e);
    }
  });
}
