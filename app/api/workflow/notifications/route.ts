import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getWorkflowNotifications } from "@/server/services/workflow";

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
    const unreadOnly = url.searchParams.get("unread") === "true";
    const data = await getWorkflowNotifications(user, { limit, unreadOnly });
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
