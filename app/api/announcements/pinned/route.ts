import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listPinnedAnnouncements } from "@/server/services/announcement";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const list = await listPinnedAnnouncements(user);
      return ok({ list });
    } catch (e) {
      return err(e);
    }
  });
}
