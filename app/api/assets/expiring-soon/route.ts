import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listExpiringSoon } from "@/server/services/asset-stats";

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "10")));
    const data = await listExpiringSoon(user, limit);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
