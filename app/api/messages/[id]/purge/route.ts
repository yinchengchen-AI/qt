// POST /api/messages/[id]/purge
// v0.24.0: 硬删一条已软删的消息 (owner), 跳过 30 天等
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { purgeMessage } from "@/server/services/message";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await purgeMessage(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
