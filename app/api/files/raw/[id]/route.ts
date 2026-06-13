// GET /api/files/raw/[id]
// 代理下载/预览:服务端从 MinIO 拉对象,流式回前端。
// 鉴权复用 presignDownload 的逻辑(canReadAttachment 助手),保证行为一致。
// 浏览器使用方:
//   - 预览 (image/pdf/office/csv/text):fetch(url).then(blob)
//   - 下载:a.href = url; a.click()
import { z } from "zod";
import { ApiError, err } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { requireSession } from "@/lib/session";
import { isMinioEnabled } from "@/lib/env";
import { canReadAttachment, getAttachmentForRead } from "@/server/storage/presign";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { ensureBucketAndCors, getS3Client } from "@/server/storage/minio";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const maxDuration = 60;

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!isMinioEnabled()) {
      throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "MinIO 未配置", 503);
    }
    const user = await requireSession();
    const { id } = paramsSchema.parse(await ctx.params);

    const att = await getAttachmentForRead(id);
    if (!att) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, "附件不存在或已删除", 404);
    }
    if (!(await canReadAttachment(att, user.id))) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "无权下载此附件", 403);
    }

    await ensureBucketAndCors();
    const client = getS3Client();
    const obj = await client.send(
      new GetObjectCommand({ Bucket: att.bucket, Key: att.objectKey })
    );
    if (!obj.Body) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, "对象在 MinIO 中为空", 404);
    }

    // AWS SDK v3 Node 端 Body 是 Readable;转 Web ReadableStream 给 Next Response
    const nodeStream = obj.Body as Readable;
    const webStream = Readable.toWeb(nodeStream) as unknown as ReadableStream;

    // RFC 5987 文件名编码(content-disposition 中文/特殊字符安全)
    const encoded = encodeURIComponent(att.originalName).replace(/['()]/g, escape).replace(/\*/g, "%2A");
    return new Response(webStream, {
      status: 200,
      headers: {
        "content-type": att.mimeType || "application/octet-stream",
        "content-length": String(obj.ContentLength ?? ""),
        "content-disposition": `attachment; filename*=UTF-8''${encoded}`,
        // 缓存:附件 ID 固定 + 对象 key 不变,允许浏览器短缓存
        "cache-control": "private, max-age=60"
      }
    });
  } catch (e) {
    return err(e);
  }
}
