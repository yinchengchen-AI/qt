// POST /api/messages/[id]/restore
// v0.24.0: 从回收站恢复一条消息 (owner)
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { restoreMessage } from "@/server/services/message";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await restoreMessage(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
