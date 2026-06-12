import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { removeTaskAttachment } from "@/server/services/workflow";
import { softDeleteAttachment } from "@/server/storage/presign";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; attId: string }> }) {
  try {
    const user = await requireSession();
    const { id, attId } = await params;
    // 1. 从 task JSON 移除
    await removeTaskAttachment(user, id, attId);
    // 2. 软删 attachment
    try {
      await softDeleteAttachment(attId, user.id);
    } catch (e) {
      // 即使软删失败(JSON 里已经移除,主体干净),只 log
      console.warn(`[workflow] softDeleteAttachment ${attId} 失败:`, e);
    }
    return ok({ id, attId });
  } catch (e) {
    return err(e);
  }
}
