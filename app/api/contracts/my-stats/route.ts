import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getMyStats } from "@/server/services/contract/workbench";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const data = await getMyStats(user);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
