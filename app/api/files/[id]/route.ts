// DELETE /api/files/[id]
// 软删除附件(写 deletedAt);不实际删 MinIO 对象(GC job 后置)
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { isMinioEnabled } from "@/lib/env";
import { softDeleteAttachment } from "@/server/storage/presign";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      if (!isMinioEnabled()) {
        throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "MinIO 未配置", 503);
      }
      const user = await requireSession();
      const { id } = await params;
      await softDeleteAttachment(id, user.id);
      return ok({ id, deletedAt: new Date().toISOString() });
    } catch (e) {
      return err(e);
    }
  });
}
