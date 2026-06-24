// presign upload / download 业务封装
// - 上传:鉴权 + MIME/大小校验 + 写 Attachment 记录 + 返回代理上传 URL
// - 下载:鉴权(角色) + 校验对象存在 + 返回代理下载 URL
// 浏览器实际拿数据走 Next.js 代理(/api/files/upload/[id] / /api/files/raw/[id]),
// 而不是直接打 MinIO — 因为 MinIO 绑在 server-localhost:9000,公网到不了;
// 代理让前端只走 3000,不需要在阿里云安全组开 9000
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { Prisma } from "@prisma/client";
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
  employeeProfileId?: string | null;
  uploadedById: string;
  // 合同交付物附件标记 (true = 这是合同"交付物"tab 的实际交付文件);
  // 写权限仅 admin / 合同签订人 / 合同负责人 (assertCanManageDeliverables)
  isDeliverable?: boolean;
};

export type PresignUploadResult = {
  attachmentId: string;
  url: string; // 相对路径,前端直接 PUT
  objectKey: string;
  expiresAt: string; // ISO
};

// 交付物附件写权限: 管理员 / 合同签订人 / 合同负责人 三者之一.
// 在 presignUpload 与 softDeleteAttachment 复用, 行为集中.
// 传 contractId 才能校验; 调用方应保证 contractId 存在 (来自 Attachment.contractId).
async function assertCanManageDeliverables(
  userId: string,
  contractId: string | null
): Promise<void> {
  if (!contractId) {
    throw new ApiError(
      ERROR_CODES.VALIDATION_FAILED,
      "交付物附件必须关联到具体合同 (contractId 缺失)",
      422
    );
  }
  const [contract, user] = await Promise.all([
    prisma.contract.findUnique({
      where: { id: contractId },
      select: { ownerUserId: true, signerId: true, deletedAt: true }
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: { select: { code: true } } }
    })
  ]);
  if (!contract || contract.deletedAt) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在或已删除", 404);
  }
  const isAdmin = user?.role?.code === "ADMIN";
  const isSigner = contract.signerId === userId;
  const isOwner = contract.ownerUserId === userId;
  if (!isAdmin && !isSigner && !isOwner) {
    throw new ApiError(
      ERROR_CODES.FORBIDDEN,
      "仅管理员/签订人/负责人可管理交付物附件",
      403
    );
  }
}

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
  // 交付物附件写权限校验: 必须在 contractId 存在的前提下, 用户是 admin / 签订人 / 负责人
  // 非交付物附件 (isDeliverable=false) 跳过此校验, 走 ROLE_PERMISSIONS 兜底
  const isDeliverable = input.isDeliverable === true;
  if (isDeliverable) {
    await assertCanManageDeliverables(input.uploadedById, input.contractId ?? null);
  }

  const att = await prisma.attachment.create({
    data: {
      objectKey: "placeholder", // 下面立即覆盖
      bucket,
      originalName: input.filename,
      mimeType: input.mimeType,
      size: input.size,
      uploadedById: input.uploadedById,
      contractId: input.contractId ?? null,
      invoiceId: input.invoiceId ?? null,
      employeeProfileId: input.employeeProfileId ?? null,
      isDeliverable
    }
  });
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  // 路径规则:
  //   合同关联: contracts/{contractId}/{yyyy}/{mm}/{cuid}-{name}.{ext}
  //   发票关联: invoices/{invoiceId}/{yyyy}/{mm}/{cuid}-{name}.{ext}
  //   员工档案关联: employee-profiles/{employeeProfileId}/{yyyy}/{mm}/{cuid}-{name}.{ext}
  //   暂未绑定: tmp/{yyyy}/{mm}/{cuid}-{name}.{ext}
  const objectKey = input.contractId
    ? `contracts/${input.contractId}/${yyyy}/${mm}/${att.id}-${safeName}.${ext}`
    : input.invoiceId
      ? `invoices/${input.invoiceId}/${yyyy}/${mm}/${att.id}-${safeName}.${ext}`
      : input.employeeProfileId
        ? `employee-profiles/${input.employeeProfileId}/${yyyy}/${mm}/${att.id}-${safeName}.${ext}`
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
  //   5) 关联员工档案: 全员可读基础信息；敏感字段已在 service 层过滤
  //   6) 都没有(tmp 上传) -> 仅上传者可读
  if (att.uploadedById === userId) return true;

  // 单次并行查询: 角色 + 合同 owner (避免 2 次顺序往返,典型 30-80ms 节省)
  const [u, contract] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { role: { select: { code: true } } } }),
    att.contractId
      ? prisma.contract.findUnique({ where: { id: att.contractId }, select: { ownerUserId: true, createdById: true } })
      : Promise.resolve(null)
  ]);
  if (u?.role?.code === "ADMIN" || u?.role?.code === "FINANCE") return true;
  if (contract && (contract.ownerUserId === userId || contract.createdById === userId)) return true;
  if (att.invoice && (att.invoice.applicantUserId === userId || att.invoice.createdById === userId)) return true;
  const invoiceContract = att.invoice?.contract;
  if (invoiceContract && (invoiceContract.ownerUserId === userId || invoiceContract.createdById === userId)) return true;
  if (att.employeeProfileId) return true;
  return false;
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
  // 交付物附件 (isDeliverable=true): admin / 合同签订人 / 合同负责人 三者之一才能删
  // 走 assertCanManageDeliverables 复用同一份鉴权逻辑
  if (att.isDeliverable) {
    await assertCanManageDeliverables(userId, att.contractId);
    await prisma.attachment.update({
      where: { id: attachmentId },
      data: { deletedAt: new Date() }
    });
    return;
  }
  // 非交付物附件: 沿用旧规则 — 上传者本人 / 合同 owner / 发票 applicant / 发票所属合同 owner / admin
  // 员工档案附件: 仅 ADMIN 可删除
  if (att.uploadedById !== userId) {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: { select: { code: true } } }
    });
    const isAdmin = u?.role?.code === "ADMIN";
    if (att.employeeProfileId && !isAdmin) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "无权删除此附件", 403);
    }
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
    if (!isAdmin && !allowed) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "无权删除此附件", 403);
    }
  }
  await prisma.attachment.update({
    where: { id: attachmentId },
    data: { deletedAt: new Date() }
  });
  // 同步清理合同 attachments JSON 快照,避免详情页/编辑页出现已删除附件
  if (att.contractId && !att.isDeliverable) {
    await removeAttachmentFromContractSnapshot(att.contractId, attachmentId);
  }
}

async function removeAttachmentFromContractSnapshot(contractId: string, attachmentId: string): Promise<void> {
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { id: true, deletedAt: true, attachments: true }
  });
  if (!contract || contract.deletedAt) return;
  const list = Array.isArray(contract.attachments)
    ? (contract.attachments as Array<{ id?: string }>)
    : [];
  const filtered = list.filter((a) => a.id !== attachmentId);
  if (filtered.length !== list.length) {
    await prisma.contract.update({
      where: { id: contractId },
      data: { attachments: filtered as Prisma.InputJsonValue }
    });
  }
}
