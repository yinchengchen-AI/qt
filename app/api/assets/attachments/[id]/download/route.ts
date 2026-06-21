// GET /api/assets/attachments/[id]/download
// 走 Next.js 代理(避免 MinIO 暴露在公网)
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { requireSession } from "@/lib/session";
import { hasPermission, RESOURCE, ACTION } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isMinioEnabled } from "@/lib/env";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      if (!isMinioEnabled())
        throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "MinIO 未配置", 503);
      const user = await requireSession();
      if (!hasPermission(user.roleCode, RESOURCE.ASSET, ACTION.READ)) {
        throw new ApiError(ERROR_CODES.FORBIDDEN, "无权访问", 403);
      }
      const { id } = await params;
      const att = await prisma.attachment.findFirst({
        where: { id, assetId: { not: null }, deletedAt: null },
      });
      if (!att) throw new ApiError(ERROR_CODES.NOT_FOUND, "附件不存在", 404);
      // 走 raw 代理(已有鉴权)
      return ok({ url: `/api/files/raw/${att.id}` });
    } catch (e) {
      return err(e);
    }
  });
}
