// P13: 回收站 — 查看/恢复已软删除的记录
import { prisma } from "@/lib/prisma";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { audit } from "@/server/audit";
import { SessionUser } from "@/lib/session";
import { ownerEq, ownerViaContract } from "@/lib/ownership";

type TrashRecord = {
  id: string;
  entityType: string;
  name: string;
  deletedAt: string;
};

type EntityConfig = {
  model: keyof typeof prisma;
  nameField: string;
  resource: string;
  /** 行级隔离: SALES 角色只看到自己的记录 */
  ownerFilter: (user: SessionUser) => Record<string, unknown>;
};

const ENTITY_CONFIG: Record<string, EntityConfig> = {
  Customer: { model: "customer", nameField: "name", resource: RESOURCE.CUSTOMER, ownerFilter: (u) => ownerEq(u) },
  Contract: { model: "contract", nameField: "contractNo", resource: RESOURCE.CONTRACT, ownerFilter: (u) => ownerEq(u) },
  Invoice: { model: "invoice", nameField: "invoiceNo", resource: RESOURCE.INVOICE, ownerFilter: (u) => ownerViaContract(u) },
  Payment: { model: "payment", nameField: "paymentNo", resource: RESOURCE.PAYMENT, ownerFilter: (u) => ownerViaContract(u) },
};

export async function getTrashList(user: SessionUser): Promise<TrashRecord[]> {
  // 服务层硬守门: 回收站列的是全公司范围的软删记录(无行级隔离), 必须 admin only.
  // 菜单项已用 ROLE.CREATE 限定为 admin 可见, 但 URL 可被绕过, 在 service 入口再卡一遍.
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可访问回收站", 403);
  }
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.READ);
  const results: TrashRecord[] = [];

  for (const [entityType, cfg] of Object.entries(ENTITY_CONFIG)) {
    type AnyFindModel = {
      findMany(args: Record<string, unknown>): Promise<{ id: string; deletedAt: Date; [key: string]: unknown }[]>;
    };
    const model = prisma[cfg.model] as unknown as AnyFindModel;
    const rows = await model.findMany({
      where: { deletedAt: { not: null }, ...cfg.ownerFilter(user) },
      select: { id: true, [cfg.nameField]: true, deletedAt: true },
      orderBy: { deletedAt: "desc" },
      take: 100
    });
    for (const row of rows) {
      results.push({
        id: row.id,
        entityType,
        name: String(row[cfg.nameField] ?? `(${entityType})`),
        deletedAt: row.deletedAt.toISOString()
      });
    }
  }

  results.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return results;
}

export async function restoreRecord(
  user: SessionUser,
  entityType: string,
  id: string
): Promise<{ restored: boolean; name: string }> {
  // 与 getTrashList 对齐: 回收站恢复是 admin-only 操作 (见 getTrashList 注释)
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可恢复回收站记录", 403);
  }
  const cfg = ENTITY_CONFIG[entityType];
  if (!cfg) throw new ApiError(ERROR_CODES.NOT_FOUND, `不支持的实体类型: ${entityType}`, 400);

  requirePermission(user.roleCode, cfg.resource as typeof RESOURCE[keyof typeof RESOURCE], ACTION.UPDATE);

  type AnyRestoreModel = {
    findFirst(args: Record<string, unknown>): Promise<{ id: string; deletedAt: Date | null; [key: string]: unknown } | null>;
    update(args: Record<string, unknown>): Promise<unknown>;
  };
  const model = prisma[cfg.model] as unknown as AnyRestoreModel;
  const row = await model.findFirst({
    where: { id, deletedAt: { not: null }, ...cfg.ownerFilter(user) },
    select: { id: true, [cfg.nameField]: true, deletedAt: true }
  });

  if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, `记录不存在或未被删除: ${entityType}#${id}`, 404);

  await model.update({
    where: { id },
    data: { deletedAt: null }
  });

  const name = String(row[cfg.nameField] ?? id);

  await audit(prisma, {
    actorId: user.id,
    action: "TRASH_RESTORE",
    entity: entityType,
    entityId: id,
    before: { deleted: true },
    after: { deleted: false, name }
  });

  return { restored: true, name };
}
