// POST /api/files/[id]/presign-download
// 鉴权(本人/ADMIN/FINANCE/合同 owner)+ 校验对象存在 + 返回 GET 预签名 URL
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { isMinioEnabled } from "@/lib/env";
import { presignDownload } from "@/server/storage/presign";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!isMinioEnabled()) {
      throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "MinIO 未配置", 503);
    }
    const user = await requireSession();
    const { id } = await params;
    const result = await presignDownload({ attachmentId: id, userId: user.id });
    return ok(result);
  } catch (e) {
    return err(e);
  }
}
