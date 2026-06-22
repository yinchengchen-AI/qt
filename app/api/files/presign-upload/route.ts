// POST /api/files/presign-upload
// body: { filename, mimeType, size, contractId?, invoiceId?, assetId?, isDeliverable? }
// 鉴权 + 校验 + 创建 Attachment 记录 + 返回 PUT 预签名 URL
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { isMinioEnabled } from "@/lib/env";
import { presignUpload } from "@/server/storage/presign";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { presignUploadBodySchema } from "@/lib/validators/upload";

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      if (!isMinioEnabled()) {
        throw new ApiError(
          ERROR_CODES.INTERNAL_ERROR,
          "MinIO 未配置,请联系管理员",
          503,
        );
      }
      const user = await requireSession();
      const raw = await req.json();
      const body = presignUploadBodySchema.parse(raw);
      const result = await presignUpload({
        filename: body.filename,
        mimeType: body.mimeType,
        size: body.size,
        contractId: body.contractId ?? null,
        invoiceId: body.invoiceId ?? null,
        assetId: body.assetId ?? null, // v1 新增
        // 合同交付物附件标记; 落库前 server/storage/presign.ts 校验 admin / 签订人 / 负责人
        isDeliverable: body.isDeliverable === true,
        uploadedById: user.id,
      });
      return ok(result);
    } catch (e) {
      return err(e);
    }
  });
}
