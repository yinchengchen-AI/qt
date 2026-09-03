import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { unreadSummary } from "@/server/services/message";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const data = await unreadSummary(user);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
