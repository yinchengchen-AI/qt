// 附件快照解析统一工具。吃掉 contract.ts:resolveAttachmentSnapshots 和
// invoice.ts:resolveInvoiceAttachmentSnapshots 两个 ~60 行副本。区别仅是绑定目标
// (contractId / invoiceId), 用 bind: "Contract" | "Invoice" 区分。
//
// 行为契约:
//   - 把前端传的附件快照用 DB 真实记录重写(防 spoofing)
//   - 事务内把 presign 时落 tmp/ 的附件绑到目标 entity (contractId / invoiceId)
//   - 已绑当前 entity: 放过
//   - 已绑其它 entity: 拒绝 (防越权)
//   - legacy- 前缀: 原样保留 (历史迁移数据, 不走 DB 校验)
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { Prisma } from "@prisma/client";

const LEGACY_PREFIX = "legacy-";
const MAX_PER_ENTITY = 5;

export type AttachmentBind = "Contract" | "Invoice";

export type RawAttachment = {
  id: string;
  name: string;
  url?: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
};

type ResolvedAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  uploadedBy: string;
  uploadedAt: string;
  url?: string;
};

/**
 * 把前端传的附件快照用 DB 真实记录重写(防 spoofing),
 * 同时在事务内把 presign 时落 tmp/ 的附件绑到目标 entity。
 */
export async function resolveAttachmentSnapshots(
  raw: RawAttachment[],
  bind: AttachmentBind,
  entityId: string,
  tx: Prisma.TransactionClient,
): Promise<Prisma.InputJsonValue> {
  if (raw.length === 0) return [] as unknown as Prisma.InputJsonValue;
  if (raw.length > MAX_PER_ENTITY) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `附件最多 ${MAX_PER_ENTITY} 个`, 400);
  }
  const legacyEntries = raw.filter((r) => r.id.startsWith(LEGACY_PREFIX));
  const realEntries = raw.filter((r) => !r.id.startsWith(LEGACY_PREFIX));

  const resolvedFromDb: ResolvedAttachment[] = [];
  if (realEntries.length > 0) {
    const ids = [...new Set(realEntries.map((r) => r.id))];
    const found = await tx.attachment.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: {
        id: true, originalName: true, mimeType: true, size: true,
        uploadedById: true, uploadedAt: true, contractId: true, invoiceId: true,
      },
    });
    if (found.length !== ids.length) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "附件 id 无效或已删除", 400);
    }
    // 绑定到当前 entity: 没绑过 -> 绑过来
    const toBind = found.filter((a) => !a.contractId && !a.invoiceId);
    if (toBind.length > 0) {
      await tx.attachment.updateMany({
        where: { id: { in: toBind.map((a) => a.id) }, contractId: null, invoiceId: null },
        data: bind === "Contract" ? { contractId: entityId } : { invoiceId: entityId },
      });
    }
    // 已绑当前 entity -> 放过; 已绑其它 -> 拒绝
    const isConflict = (a: typeof found[number]): boolean => {
      if (bind === "Contract") {
        if (a.invoiceId) return true;
        if (a.contractId && a.contractId !== entityId) return true;
        return false;
      }
      if (a.contractId) return true;
      if (a.invoiceId && a.invoiceId !== entityId) return true;
      return false;
    };
    const others = found.filter(isConflict);
    if (others.length > 0) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "部分附件已绑定到其它合同/发票", 403);
    }
    resolvedFromDb.push(...found.map((a) => ({
      id: a.id,
      name: a.originalName,
      mimeType: a.mimeType,
      size: a.size,
      uploadedBy: a.uploadedById,
      uploadedAt: a.uploadedAt.toISOString(),
    })));
  }

  // 保持原顺序: legacy 在它提交的位置保留; real 用 DB 记录覆盖
  const byId = new Map<string, ResolvedAttachment>();
  for (const e of legacyEntries) byId.set(e.id, e as ResolvedAttachment);
  for (const e of resolvedFromDb) byId.set(e.id, e);
  return raw.map((r) => byId.get(r.id)!) as unknown as Prisma.InputJsonValue;
}
