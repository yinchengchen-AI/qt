// P13: 回收站 — 查看/恢复已软删除的记录
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/permissions";
import { RESOURCE, ACTION } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { audit } from "@/server/audit";
import { SessionUser } from "@/lib/session";

type TrashRecord = {
  id: string;
  entityType: string;
  name: string;
  deletedAt: string;
  extra?: Record<string, unknown>;
};

const ENTITY_CONFIG: Record<string, { model: keyof typeof prisma; nameField: string; resource: string }> = {
  Customer: { model: "customer", nameField: "name", resource: RESOURCE.CUSTOMER },
  Contract: { model: "contract", nameField: "contractNo", resource: RESOURCE.CONTRACT },
  Project: { model: "project", nameField: "name", resource: RESOURCE.PROJECT },
  Invoice: { model: "invoice", nameField: "invoiceNo", resource: RESOURCE.INVOICE },
  Payment: { model: "payment", nameField: "paymentNo", resource: RESOURCE.PAYMENT },
  WorkflowTemplate: { model: "workflowTemplate", nameField: "name", resource: RESOURCE.WORKFLOW_TEMPLATE },
};

export async function getTrashList(user: SessionUser): Promise<TrashRecord[]> {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.READ); // admin 级别
  const results: TrashRecord[] = [];

  for (const [entityType, cfg] of Object.entries(ENTITY_CONFIG)) {
    const model = prisma[cfg.model] as { findMany: (args: unknown) => Promise<{ id: string; deletedAt: Date }[]> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await model.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, [cfg.nameField]: true, deletedAt: true },
      orderBy: { deletedAt: "desc" },
      take: 100
    } as never) as { id: string; deletedAt: Date; [key: string]: unknown }[];
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

  const model = prisma[cfg.model] as { findFirst: (args: unknown) => Promise<{ id: string; deletedAt: Date | null } | null>; update: (args: unknown) => Promise<unknown> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await model.findFirst({
    where: { id, deletedAt: { not: null } },
    select: { id: true, [cfg.nameField]: true, deletedAt: true }
  } as never) as { id: string; deletedAt: Date | null; [key: string]: unknown } | null;

  if (!row) throw new ApiError(ERROR_CODES.NOT_FOUND, `记录不存在或未被删除: ${entityType}#${id}`, 404);

  await model.update({
    where: { id },
    data: { deletedAt: null }
  } as never);

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
