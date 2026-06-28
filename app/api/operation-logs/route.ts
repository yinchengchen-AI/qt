// 操作日志查询（仅 ADMIN）
// 支持过滤：entity / action / actorId / entityId / ip / status / 时间范围
// 返回：基础字段 + 新审计字段（userAgent / requestId / method / path / status / errorMessage）
//     + actor 名字 / 是否系统用户
import { z } from "zod";
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SYSTEM_USER_ID, isSystemUser } from "@/lib/system";
import { entityLabel } from "@/lib/operation-log-format";

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  entity: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().optional(),
  entityId: z.string().optional(),
  // 新增过滤
  ip: z.string().optional(),
  status: z.enum(["SUCCESS", "FAILURE"]).optional(),
  // 时间范围筛选(对应 `at` 字段)
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.OPERATION_LOG, ACTION.READ);
      const url = new URL(req.url);
      const p = query.parse(Object.fromEntries(url.searchParams));
      const from = p.from ? new Date(p.from) : undefined;
      const to = p.to ? new Date(p.to) : undefined;
      const where: import("@prisma/client").Prisma.OperationLogWhereInput = {
        ...(p.entity ? { entity: p.entity } : {}),
        ...(p.action ? { action: p.action } : {}),
        ...(p.actorId ? { actorId: p.actorId } : {}),
        ...(p.entityId ? { entityId: p.entityId } : {}),
        ...(p.ip ? { ip: { contains: p.ip } } : {}),
        ...(p.status ? { status: p.status } : {}),
        ...(from || to
          ? { at: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      };
      const [list, total] = await Promise.all([
        prisma.operationLog.findMany({
          where,
          orderBy: { at: "desc" },
          skip: (p.page - 1) * p.pageSize,
          take: p.pageSize,
          select: {
            id: true,
            actorId: true,
            action: true,
            entity: true,
            entityId: true,
            diff: true,
            ip: true,
            userAgent: true,
            requestId: true,
            method: true,
            path: true,
            status: true,
            errorMessage: true,
            at: true,
          },
        }),
        prisma.operationLog.count({ where }),
      ]);
      // 查 actor 名字（一次查询所有相关 userId）
      const actorIds = Array.from(new Set(list.map((l) => l.actorId)));
      const actors =
        actorIds.length > 0 && actorIds.some((id) => !isSystemUser(id))
          ? await prisma.user.findMany({
              where: { id: { in: actorIds.filter((id) => !isSystemUser(id)) } },
              select: { id: true, name: true, employeeNo: true, email: true },
            })
          : [];
      const actorMap = new Map(actors.map((a) => [a.id, a]));
      const enriched = list.map((l) => {
        const isSystem = isSystemUser(l.actorId);
        return {
          ...l,
          actor: isSystem
            ? {
                id: SYSTEM_USER_ID,
                name: "系统",
                employeeNo: "SYSTEM",
                email: null,
                isSystem: true,
              }
            : actorMap.get(l.actorId)
              ? {
                  ...actorMap.get(l.actorId)!,
                  isSystem: false,
                }
              : null,
          entityLabel: entityLabel(l.entity),
        };
      });
      return ok({
        list: enriched,
        total,
        page: p.page,
        pageSize: p.pageSize,
      });
    } catch (e) {
      return err(e);
    }
  });
}
