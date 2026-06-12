import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getFollowUpOverview } from "@/server/services/customer";

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const days = url.searchParams.get("days") ? Number(url.searchParams.get("days")) : undefined;
    const method = url.searchParams.get("method") ?? undefined;
    const result = url.searchParams.get("result") ?? undefined;
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const data = await getFollowUpOverview(user, { days, method, result, limit });
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
