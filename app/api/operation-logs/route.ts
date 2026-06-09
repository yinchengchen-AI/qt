// 操作日志查询（仅 ADMIN）
import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  entity: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().optional(),
  entityId: z.string().optional()
});

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    requirePermission(user.roleCode, RESOURCE.OPERATION_LOG, ACTION.READ);
    const url = new URL(req.url);
    const p = query.parse(Object.fromEntries(url.searchParams));
    const where: import("@prisma/client").Prisma.OperationLogWhereInput = {
      ...(p.entity ? { entity: p.entity } : {}),
      ...(p.action ? { action: p.action } : {}),
      ...(p.actorId ? { actorId: p.actorId } : {}),
      ...(p.entityId ? { entityId: p.entityId } : {})
    };
    const [list, total] = await Promise.all([
      prisma.operationLog.findMany({
        where,
        orderBy: { at: "desc" },
        skip: (p.page - 1) * p.pageSize,
        take: p.pageSize,
        select: { id: true, actorId: true, action: true, entity: true, entityId: true, diff: true, ip: true, at: true }
      }),
      prisma.operationLog.count({ where })
    ]);
    // 查 actor 名字（一次查询所有相关 userId）
    const actorIds = Array.from(new Set(list.map((l) => l.actorId)));
    const actors = actorIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, employeeNo: true } })
      : [];
    const actorMap = new Map(actors.map((a) => [a.id, a]));
    const enriched = list.map((l) => ({ ...l, actor: actorMap.get(l.actorId) ?? null }));
    return ok({ list: enriched, total, page: p.page, pageSize: p.pageSize });
  } catch (e) {
    return err(e);
  }
}
