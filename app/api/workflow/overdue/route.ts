import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getOverdueTasks } from "@/server/services/workflow";

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
    const data = await getOverdueTasks(user, { limit });
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
