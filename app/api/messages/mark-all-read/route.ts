import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { markAllRead } from "@/server/services/message";

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const data = await markAllRead(user);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
