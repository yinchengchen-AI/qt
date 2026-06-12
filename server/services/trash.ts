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
  Project: { model: "project", nameField: "name", resource: RESOURCE.PROJECT, ownerFilter: (u) => ownerViaContract(u) },
  Invoice: { model: "invoice", nameField: "invoiceNo", resource: RESOURCE.INVOICE, ownerFilter: (u) => ownerViaContract(u) },
  Payment: { model: "payment", nameField: "paymentNo", resource: RESOURCE.PAYMENT, ownerFilter: (u) => ownerViaContract(u) },
  WorkflowTemplate: { model: "workflowTemplate", nameField: "name", resource: RESOURCE.WORKFLOW_TEMPLATE, ownerFilter: () => ({}) },
};

export async function getTrashList(user: SessionUser): Promise<TrashRecord[]> {
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
