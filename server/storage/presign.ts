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
  invoiceId?: string | null;
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
      contractId: input.contractId ?? null,
      invoiceId: input.invoiceId ?? null
    }
  });
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  // 路径规则:
  //   合同关联: contracts/{contractId}/{yyyy}/{mm}/{cuid}-{name}.{ext}
  //   发票关联: invoices/{invoiceId}/{yyyy}/{mm}/{cuid}-{name}.{ext}
  //   暂未绑定: tmp/{yyyy}/{mm}/{cuid}-{name}.{ext}
  const objectKey = input.contractId
    ? `contracts/${input.contractId}/${yyyy}/${mm}/${att.id}-${safeName}.${ext}`
    : input.invoiceId
      ? `invoices/${input.invoiceId}/${yyyy}/${mm}/${att.id}-${safeName}.${ext}`
      : `tmp/${yyyy}/${mm}/${att.id}-${safeName}.${ext}`;

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
    where: { id: input.attachmentId },
    include: { invoice: { select: { id: true, applicantUserId: true, createdById: true, contractId: true, contract: { select: { ownerUserId: true, createdById: true } } } } }
  });
  if (!att || att.deletedAt) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, "附件不存在或已删除", 404);
  }

  // 鉴权规则(放行其一即可):
  //   1) 上传者本人
  //   2) ADMIN / FINANCE 角色
  //   3) 关联合同: 合同的 ownerUserId / createdById
  //   4) 关联发票: 发票的 applicantUserId / createdById,或发票所属合同的 owner/createdBy
  //   5) 都没有(tmp 上传) -> 仅上传者可下
  if (att.uploadedById !== input.userId) {
    const u = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { role: { select: { code: true } } }
    });
    const isPrivileged = u?.role?.code === "ADMIN" || u?.role?.code === "FINANCE";
    if (!isPrivileged) {
      let canSee = false;
      if (att.contractId) {
        const c = await prisma.contract.findUnique({
          where: { id: att.contractId },
          select: { ownerUserId: true, createdById: true }
        });
        canSee = !!(c && (c.ownerUserId === input.userId || c.createdById === input.userId));
      }
      if (!canSee && att.invoice) {
        canSee = att.invoice.applicantUserId === input.userId || att.invoice.createdById === input.userId;
        if (!canSee && att.invoice.contract) {
          const c = att.invoice.contract;
          canSee = c.ownerUserId === input.userId || c.createdById === input.userId;
        }
      }
      // 工作流任务附件:无合同/发票关联,通过 JSON 字段反查
      if (!canSee) {
        const tasks = await prisma.workflowTaskInstance.findMany({
          where: { deletedAt: null, attachments: { path: ["items"], array_contains: [{ id: att.id }] } },
          select: {
            id: true,
            project: { select: { contract: { select: { ownerUserId: true, createdById: true } } } }
          }
        });
        canSee = tasks.some(
          (t) => t.project.contract?.ownerUserId === input.userId || t.project.contract?.createdById === input.userId
        );
      }
      if (!canSee) {
        throw new ApiError(ERROR_CODES.FORBIDDEN, "无权下载此附件", 403);
      }
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
  const att = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: { invoice: { select: { id: true, applicantUserId: true, createdById: true, contractId: true, contract: { select: { ownerUserId: true, createdById: true } } } } }
  });
  if (!att || att.deletedAt) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, "附件不存在", 404);
  }
  // 鉴权:上传者本人 / 合同 owner / 发票 applicant / 发票所属合同 owner / admin
  if (att.uploadedById !== userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: { select: { code: true } } }
    });
    const isAdmin = u?.role?.code === "ADMIN";
    let allowed = false;
    if (att.contractId) {
      const c = await prisma.contract.findUnique({
        where: { id: att.contractId },
        select: { ownerUserId: true }
      });
      if (c?.ownerUserId === userId) allowed = true;
    }
    if (!allowed && att.invoice) {
      if (att.invoice.applicantUserId === userId || att.invoice.createdById === userId) {
        allowed = true;
      } else if (att.invoice.contract) {
        const c = att.invoice.contract;
        if (c.ownerUserId === userId || c.createdById === userId) allowed = true;
      }
    }
    // 工作流任务附件:无合同/发票关联时,通过 JSON 字段反查
    if (!isAdmin && !allowed) {
      const tasks = await prisma.workflowTaskInstance.findMany({
        where: { deletedAt: null, attachments: { path: ["items"], array_contains: [{ id: att.id }] } },
        select: { id: true, project: { select: { contract: { select: { ownerUserId: true, createdById: true } } } } }
      });
      allowed = tasks.some(
        (t) => t.project.contract?.ownerUserId === userId || t.project.contract?.createdById === userId
      );
      // 项目经理 / 任务指派人 / 任务完成人 也可删
      if (!allowed) {
        const assignees = await prisma.workflowTaskInstance.findMany({
          where: { deletedAt: null, OR: [{ assigneeId: userId }, { completedById: userId }] },
          select: { id: true }
        });
        const myInsIds = new Set(assignees.map((x) => x.id));
        if (tasks.some((t) => myInsIds.has(t.id))) allowed = true;
      }
    }
    if (!isAdmin && !allowed) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "无权删除此附件", 403);
    }
  }
  await prisma.attachment.update({
    where: { id: attachmentId },
    data: { deletedAt: new Date() }
  });
}
