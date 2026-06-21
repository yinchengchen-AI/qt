import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { getWorkflowOverview } from "@/server/services/workflow";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const data = await getWorkflowOverview(user);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
