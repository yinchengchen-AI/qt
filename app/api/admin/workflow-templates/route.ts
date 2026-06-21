import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { listTemplates } from "@/server/services/workflow-template";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const data = await listTemplates(user);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
