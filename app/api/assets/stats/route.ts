import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getAssetStats } from "@/server/services/asset-stats";

export async function GET() {
  try {
    const user = await requireSession();
    const data = await getAssetStats(user);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
