// 软删统一入口。吃掉 contract.ts:softDeleteContract (Serializable + 3 次重试 +
// 子数据校验) + customer.ts:softDeleteCustomer (无 Serializable) 两份样板。
// 统一 Serializable + 3 次重试 + 统一 ENTITY_IMMUTABLE 错误码。
import { Prisma } from "@prisma/client";
import type { Prisma as PrismaNS } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";

const SERIALIZABLE_RETRY = 3;
const TX_TIMEOUT_MS = 10_000;

type Entity = "Contract" | "Customer" | "Invoice" | "Payment";

export type SoftDeleteSpec = {
  entity: Entity;
  /** tx 内查主表(带软删 + 行级隔离过滤) */
  findInTx: (tx: PrismaNS.TransactionClient, id: string) => Promise<{ id: string; deletedAt: Date | null } | null>;
  /** tx 内做软删 update(写 deletedAt + updatedById) */
  updateInTx: (tx: PrismaNS.TransactionClient, id: string, deletedAt: Date, actorId: string) => Promise<{ id: string; deletedAt: Date | null }>;
  /** tx 内做业务校验(子数据 count 等),抛 ApiError 拒绝 */
  preDeleteCheck: (tx: PrismaNS.TransactionClient) => Promise<void>;
  /** audit 字段(actorId 必填,before 必填) */
  audit: { actorId: string; before: Record<string, unknown> };
};

/**
 * 软删统一入口。Serializable + P2034 重试 3 次。
 * 行级隔离由 caller 在 findInTx 内通过 ownershipWhere 注入。
 */
export async function softDelete(
  user: SessionUser,
  spec: SoftDeleteSpec & { id: string },
): Promise<{ id: string; deletedAt: Date }> {
  for (let attempt = 1; attempt <= SERIALIZABLE_RETRY; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const current = await spec.findInTx(tx, spec.id);
          if (!current) throw new ApiError(ERROR_CODES.NOT_FOUND, `${spec.entity}不存在`, 404);
          if (current.deletedAt) {
            throw new ApiError(ERROR_CODES.NOT_FOUND, `${spec.entity}不存在`, 404);
          }
          await spec.preDeleteCheck(tx);
          const deletedAt = new Date();
          const updated = await spec.updateInTx(tx, spec.id, deletedAt, user.id);
          // Prisma select 返回 nullable; 我们刚 set, 不会是 null, 落 null 时回退到传入的 deletedAt
          const r = { id: updated.id, deletedAt: updated.deletedAt ?? deletedAt };
          await audit(tx, {
            actorId: spec.audit.actorId,
            action: `${spec.entity.toUpperCase()}_SOFT_DELETE`,
            entity: spec.entity,
            entityId: spec.id,
            before: spec.audit.before,
            after: { deleted: true },
          });
          return r;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: TX_TIMEOUT_MS },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034" && attempt < SERIALIZABLE_RETRY) {
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable: SERIALIZABLE_RETRY exhausted");
}
