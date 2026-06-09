import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { markRead, deleteMessage } from "@/server/services/message";

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await markRead(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await deleteMessage(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
