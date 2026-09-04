// POST /api/messages/archive/[id]/restore
// v0.24.0: 用户从自己的归档里恢复一条到收件箱
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { restoreUserArchive } from "@/server/services/message";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await restoreUserArchive(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
