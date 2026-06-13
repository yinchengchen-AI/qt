// PUT /api/files/upload/[id]
// 代理上传:浏览器 PUT raw body 到这里,服务端用 SDK 写到 MinIO。
// 设计原因:MinIO 绑在 server-localhost:9000,公网到不了;用 Next.js 代理可以让前端只走 3000。
// 鉴权 + 业务校验:
//   - 必须是登录用户
//   - 必须是该 Attachment 的 uploadedById(防止越权 PUT 到别人记录里)
//   - 必须在 5 分钟 TTL 内(对应 presign-upload 下发的 expiresAt)
//   - Content-Length 必须 <= MAX_FILE_SIZE 且匹配 size 字段
//   - Content-Type 必须匹配 mimeType 字段
import { z } from "zod";
import { ok, err, ApiError } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { isMinioEnabled } from "@/lib/env";
import { ERROR_CODES } from "@/types/errors";
import { prisma } from "@/lib/prisma";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { ensureBucketAndCors, getS3Client, getBucket, MAX_FILE_SIZE } from "@/server/storage/minio";

export const runtime = "nodejs";
// 默认 Next 路由 body 限制是 1MB,文件最大 20MB 要显式调高
export const maxDuration = 60;

const paramsSchema = z.object({ id: z.string().min(1).max(64) });

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!isMinioEnabled()) {
      throw new ApiError(ERROR_CODES.INTERNAL_ERROR, "MinIO 未配置", 503);
    }
    const user = await requireSession();
    const { id } = paramsSchema.parse(await ctx.params);

    const att = await prisma.attachment.findUnique({
      where: { id },
      select: {
        id: true,
        objectKey: true,
        bucket: true,
        mimeType: true,
        size: true,
        uploadedById: true,
        deletedAt: true,
        uploadedAt: true
      }
    });
    if (!att || att.deletedAt) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, "附件不存在或已删除", 404);
    }
    // 鉴权:仅上传者可写(防止越权 PUT 覆盖别人记录)
    if (att.uploadedById !== user.id) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "无权上传此附件", 403);
    }
    // 5 分钟 TTL(对齐 presignUpload 的 UPLOAD_TTL_SEC)
    const ageMs = Date.now() - att.uploadedAt.getTime();
    if (ageMs > 5 * 60 * 1000) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "上传链接已过期,请重新获取 presign-upload", 410);
    }

    // Content-Length 校验(优先信 header;没有就回头校验 buffer)
    const declaredLen = Number(req.headers.get("content-length") ?? "0");
    if (declaredLen > MAX_FILE_SIZE) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `文件过大(>${MAX_FILE_SIZE / 1024 / 1024}MB)`,
        413
      );
    }
    const declaredType = req.headers.get("content-type") ?? "";
    if (declaredType && declaredType !== att.mimeType) {
      // antd upload 默认会带原始 mime;不强制相等,只在声明了不同时报警
      console.warn(`[upload proxy] content-type 漂移: declared=${declaredType} expected=${att.mimeType}`);
    }

    // 读 body(20MB 上限可控;不流式,简化代码)
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.length === 0) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "空 body", 400);
    }
    if (buf.length > MAX_FILE_SIZE) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `文件过大(>${MAX_FILE_SIZE / 1024 / 1024}MB)`, 413);
    }
    if (att.size > 0 && buf.length !== att.size) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `文件大小不匹配:声明=${att.size} 实际=${buf.length}`,
        400
      );
    }

    await ensureBucketAndCors();
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: att.objectKey,
        Body: buf,
        ContentType: att.mimeType,
        ContentLength: buf.length
      })
    );

    return ok({ id: att.id, objectKey: att.objectKey, size: buf.length });
  } catch (e) {
    return err(e);
  }
}
