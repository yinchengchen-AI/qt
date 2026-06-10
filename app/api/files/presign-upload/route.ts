// POST /api/files/presign-upload
// body: { filename, mimeType, size, contractId?, invoiceId? }
// 鉴权 + 校验 + 创建 Attachment 记录 + 返回 PUT 预签名 URL
import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { isMinioEnabled } from "@/lib/env";
import { presignUpload } from "@/server/storage/presign";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

const bodySchema = z.object({
  filename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  size: z.number().int().positive(),
  contractId: z.string().optional().nullable(),
  invoiceId: z.string().optional().nullable()
});

export async function POST(req: Request) {
  try {
    if (!isMinioEnabled()) {
      throw new ApiError(
        ERROR_CODES.INTERNAL_ERROR,
        "MinIO 未配置,请联系管理员",
        503
      );
    }
    const user = await requireSession();
    const raw = await req.json();
    const body = bodySchema.parse(raw);
    const result = await presignUpload({
      filename: body.filename,
      mimeType: body.mimeType,
      size: body.size,
      contractId: body.contractId ?? null,
      invoiceId: body.invoiceId ?? null,
      uploadedById: user.id
    });
    return ok(result);
  } catch (e) {
    return err(e);
  }
}
