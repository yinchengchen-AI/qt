// presign upload / download 业务封装
// - 上传:鉴权 + MIME/大小校验 + 写 Attachment 记录 + 签 PUT URL
// - 下载:鉴权(角色) + 校验对象存在 + 签 GET URL(带 content-disposition)
import { PutObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  ensureBucketAndCors,
  extFromMime,
  getBucket,
  getS3Client,
  isAllowedMimeType,
  slugFilename
} from "./minio";

const UPLOAD_TTL_SEC = 5 * 60; // 5 min
const DOWNLOAD_TTL_SEC = 5 * 60; // 5 min

export type PresignUploadInput = {
  filename: string;
  mimeType: string;
  size: number;
  contractId?: string | null;
  uploadedById: string;
};

export type PresignUploadResult = {
  attachmentId: string;
  url: string;
  objectKey: string;
  expiresAt: string; // ISO
};

export async function presignUpload(input: PresignUploadInput): Promise<PresignUploadResult> {
  if (!isAllowedMimeType(input.mimeType)) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `不支持的文件类型:${input.mimeType};允许:${[...ALLOWED_MIME_TYPES].join(", ")}`,
      400
    );
  }
  if (input.size <= 0 || input.size > MAX_FILE_SIZE) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      `文件大小必须在 1B ~ ${MAX_FILE_SIZE / 1024 / 1024}MB 之间`,
      400
    );
  }
  if (!input.filename || input.filename.length > 255) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "filename 无效", 400);
  }

  await ensureBucketAndCors();
  const client = getS3Client();
  const bucket = getBucket();
  const ext = extFromMime(input.mimeType);
  const safeName = slugFilename(input.filename).replace(/\.[^.]+$/, "") || "file";

  // 先写 Attachment 记录,拿到 cuid 作为 objectKey 一部分
  // 这样下载时直接按 id 查即可,objectKey 永远从 DB 出,不会因前端篡改而越权
  const now = new Date();
  const att = await prisma.attachment.create({
    data: {
      objectKey: "placeholder", // 下面立即覆盖
      bucket,
      originalName: input.filename,
      mimeType: input.mimeType,
      size: input.size,
      uploadedById: input.uploadedById,
      contractId: input.contractId ?? null
    }
  });
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const objectKey = input.contractId
    ? `contracts/${input.contractId}/${yyyy}/${mm}/${att.id}-${safeName}.${ext}`
    : `contracts/tmp/${yyyy}/${mm}/${att.id}-${safeName}.${ext}`;

  await prisma.attachment.update({
    where: { id: att.id },
    data: { objectKey }
  });

  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    ContentType: input.mimeType,
    ContentLength: input.size
  });
  const url = await getSignedUrl(client, cmd, { expiresIn: UPLOAD_TTL_SEC });
  return {
    attachmentId: att.id,
    url,
    objectKey,
    expiresAt: new Date(now.getTime() + UPLOAD_TTL_SEC * 1000).toISOString()
  };
}

export type PresignDownloadInput = {
  attachmentId: string;
  userId: string;
};

export type PresignDownloadResult = {
  url: string;
  expiresAt: string;
  originalName: string;
  size: number;
  mimeType: string;
};

export async function presignDownload(input: PresignDownloadInput): Promise<PresignDownloadResult> {
  const att = await prisma.attachment.findUnique({
    where: { id: input.attachmentId }
  });
  if (!att || att.deletedAt) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, "附件不存在或已删除", 404);
  }

  // 鉴权:登录用户可下自己上传的;admin/finance/拥有该合同的业务可下任何
  if (att.uploadedById !== input.userId) {
    const u = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { role: { select: { code: true } } }
    });
    const isPrivileged = u?.role?.code === "ADMIN" || u?.role?.code === "FINANCE";
    if (!isPrivileged && att.contractId) {
      const c = await prisma.contract.findUnique({
        where: { id: att.contractId },
        select: { ownerUserId: true, createdById: true }
      });
      const canSee = c && (c.ownerUserId === input.userId || c.createdById === input.userId);
      if (!canSee) {
        throw new ApiError(ERROR_CODES.FORBIDDEN, "无权下载此附件", 403);
      }
    } else if (!isPrivileged) {
      // 未绑定合同的附件(临时上传)且非特权 -> 仅上传者可下
      throw new ApiError(ERROR_CODES.FORBIDDEN, "无权下载此附件", 403);
    }
  }

  await ensureBucketAndCors();
  const client = getS3Client();

  // 校验对象真实存在
  try {
    await client.send(new HeadObjectCommand({ Bucket: att.bucket, Key: att.objectKey }));
  } catch {
    throw new ApiError(ERROR_CODES.NOT_FOUND, "对象在 MinIO 中不存在", 404);
  }

  const cmd = new GetObjectCommand({
    Bucket: att.bucket,
    Key: att.objectKey,
    ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(att.originalName)}`,
    ResponseContentType: att.mimeType
  });
  const url = await getSignedUrl(client, cmd, { expiresIn: DOWNLOAD_TTL_SEC });
  return {
    url,
    expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SEC * 1000).toISOString(),
    originalName: att.originalName,
    size: att.size,
    mimeType: att.mimeType
  };
}

// 软删除
export async function softDeleteAttachment(attachmentId: string, userId: string): Promise<void> {
  const att = await prisma.attachment.findUnique({ where: { id: attachmentId } });
  if (!att || att.deletedAt) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, "附件不存在", 404);
  }
  // 鉴权:上传者本人 / 合同 owner / admin
  if (att.uploadedById !== userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: { select: { code: true } } }
    });
    const isAdmin = u?.role?.code === "ADMIN";
    let isContractOwner = false;
    if (att.contractId) {
      const c = await prisma.contract.findUnique({
        where: { id: att.contractId },
        select: { ownerUserId: true }
      });
      isContractOwner = c?.ownerUserId === userId;
    }
    if (!isAdmin && !isContractOwner) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "无权删除此附件", 403);
    }
  }
  await prisma.attachment.update({
    where: { id: attachmentId },
    data: { deletedAt: new Date() }
  });
}
