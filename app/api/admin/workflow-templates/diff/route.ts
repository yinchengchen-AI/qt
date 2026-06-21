import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { diffTemplates } from "@/server/services/workflow-template";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const fromId = url.searchParams.get("fromId");
      const toId = url.searchParams.get("toId");
      if (!fromId || !toId) {
        return err(new Error("fromId 与 toId 必填"));
      }
      const data = await diffTemplates(user, fromId, toId);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
