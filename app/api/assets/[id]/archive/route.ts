// POST /api/assets/[id]/archive  归档
// POST /api/assets/[id]/restore   恢复
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { archiveAsset } from "@/server/services/asset";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await archiveAsset(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
