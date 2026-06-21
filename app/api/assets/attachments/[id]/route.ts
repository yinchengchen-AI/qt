// DELETE /api/assets/attachments/[id]
// 软删资产附件;ADMIN-only 写规则 (与 lib/permissions.ts:62 一致)
import { ok, err, ApiError } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { hasPermission, RESOURCE, ACTION } from "@/lib/permissions";
import { ERROR_CODES } from "@/types/errors";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const att = await prisma.attachment.findFirst({
        where: { id, deletedAt: null },
      });
      if (!att) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, "附件不存在", 404);
      }
      // 权限:有 RESOURCE.ASSET / ACTION.UPDATE (ADMIN-only,与 §7 一致)
      if (!hasPermission(user.roleCode, RESOURCE.ASSET, ACTION.UPDATE)) {
        throw new ApiError(ERROR_CODES.FORBIDDEN, "无权限删除附件", 403);
      }
      await prisma.attachment.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      return ok({ id });
    } catch (e) {
      return err(e);
    }
  });
}
