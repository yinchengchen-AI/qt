// presign upload / download 业务封装
// - 上传:鉴权 + MIME/大小校验 + 写 Attachment 记录 + 返回代理上传 URL
// - 下载:鉴权(角色) + 校验对象存在 + 返回代理下载 URL
// 浏览器实际拿数据走 Next.js 代理(/api/files/upload/[id] / /api/files/raw/[id]),
// 而不是直接打 MinIO — 因为 MinIO 绑在 server-localhost:9000,公网到不了;
// 代理让前端只走 3000,不需要在阿里云安全组开 9000
import { HeadObjectCommand } from "@aws-sdk/client-s3";
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
  url: string; // 相对路径,前端直接 PUT
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

  // 走 Next.js 代理 — 前端 PUT 到 /api/files/upload/<id>,路由会做鉴权 + 写 MinIO
  const url = `/api/files/upload/${att.id}`;
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

// 通用读取附件 + 鉴权(被 presignDownload 和 /api/files/raw/[id] 共用)
// 保证下载授权逻辑只有一份,行为一致
export type AttachmentForRead = NonNullable<Awaited<ReturnType<typeof getAttachmentForRead>>>;

export async function getAttachmentForRead(id: string) {
  return prisma.attachment.findUnique({
    where: { id },
    include: {
      invoice: {
        select: {
          id: true,
          applicantUserId: true,
          createdById: true,
          contractId: true,
          contract: { select: { ownerUserId: true, createdById: true } }
        }
      }
    }
  });
}

export async function canReadAttachment(att: AttachmentForRead, userId: string): Promise<boolean> {
  // 鉴权规则(放行其一即可):
  //   1) 上传者本人
  //   2) ADMIN / FINANCE 角色
  //   3) 关联合同: 合同的 ownerUserId / createdById
  //   4) 关联发票: 发票的 applicantUserId / createdById,或发票所属合同的 owner/createdBy
  //   5) 都没有(tmp 上传) -> 仅上传者可读
  if (att.uploadedById === userId) return true;

  // 单次并行查询: 角色 + 合同 owner + 工作流任务中的合同 owner
  // (避免 3 次顺序往返,典型 50-150ms 节省)
  const [u, contract, tasks] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: { select: { code: true } } } }),
    att.contractId
      ? prisma.contract.findUnique({ where: { id: att.contractId }, select: { ownerUserId: true, createdById: true } })
      : Promise.resolve(null),
    prisma.workflowTaskInstance.findMany({
      where: { deletedAt: null, attachments: { path: ["items"], array_contains: [{ id: att.id }] } },
      select: { id: true, project: { select: { contract: { select: { ownerUserId: true, createdById: true } } } } }
    })
  ]);
  if (u?.role?.code === "ADMIN" || u?.role?.code === "FINANCE") return true;
  if (contract && (contract.ownerUserId === userId || contract.createdById === userId)) return true;
  if (att.invoice && (att.invoice.applicantUserId === userId || att.invoice.createdById === userId)) return true;
  const invoiceContract = att.invoice?.contract;
  if (invoiceContract && (invoiceContract.ownerUserId === userId || invoiceContract.createdById === userId)) return true;
  return tasks.some(
    (t) => t.project.contract?.ownerUserId === userId || t.project.contract?.createdById === userId
  );
}

export async function presignDownload(input: PresignDownloadInput): Promise<PresignDownloadResult> {
  const att = await getAttachmentForRead(input.attachmentId);
  if (!att || att.deletedAt) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, "附件不存在或已删除", 404);
  }
  if (!(await canReadAttachment(att, input.userId))) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "无权下载此附件", 403);
  }

  await ensureBucketAndCors();
  const client = getS3Client();

  // 校验对象真实存在(defense-in-depth:raw 路由会再 GetObject 一次)
  try {
    await client.send(new HeadObjectCommand({ Bucket: att.bucket, Key: att.objectKey }));
  } catch {
    throw new ApiError(ERROR_CODES.NOT_FOUND, "对象在 MinIO 中不存在", 404);
  }

  // 走 Next.js 代理 — 前端 GET /api/files/raw/<id>,路由会做同样的鉴权 + 流式回对象
  const url = `/api/files/raw/${att.id}`;
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
