import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { markRead, deleteMessage } from "@/server/services/message";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await markRead(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await deleteMessage(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
