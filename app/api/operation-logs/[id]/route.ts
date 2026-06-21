// 单条操作日志详情（含全量 diff / UA / 请求上下文 / 关联实体的可读名）
// 仅 ADMIN。Prisma 不支持全 entity 通用 findUnique,所以针对已知 entity 做 best-effort 查找。
import { z } from "zod";
import { ok, err, ApiError } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SYSTEM_USER_ID, isSystemUser } from "@/lib/system";
import { entityLabel, entityHref } from "@/lib/operation-log-format";
import { ERROR_CODES } from "@/types/errors";

const paramsSchema = z.object({ id: z.string().min(1) });

async function lookupEntityLabel(
  entity: string,
  entityId: string,
): Promise<string | null> {
  // 返回关联实体的"人类可读标识"——合同号 / 客户名 / 项目名 等。
  // 找不到时回退 null,前端仅显示 entityId。
  try {
    switch (entity) {
      case "Contract": {
        const c = await prisma.contract.findUnique({
          where: { id: entityId },
          select: { contractNo: true, title: true },
        });
        return c ? `${c.contractNo} ${c.title}` : null;
      }
      case "Customer": {
        const c = await prisma.customer.findUnique({
          where: { id: entityId },
          select: { code: true, name: true },
        });
        return c ? `${c.code} ${c.name}` : null;
      }
      case "Invoice": {
        const i = await prisma.invoice.findUnique({
          where: { id: entityId },
          select: { invoiceNo: true },
        });
        return i?.invoiceNo ?? null;
      }
      case "Payment": {
        const p = await prisma.payment.findUnique({
          where: { id: entityId },
          select: { id: true },
        });
        return p?.id ?? null;
      }
      case "Project": {
        const p = await prisma.project.findUnique({
          where: { id: entityId },
          select: { name: true },
        });
        return p?.name ?? null;
      }
      case "User": {
        const u = await prisma.user.findUnique({
          where: { id: entityId },
          select: { employeeNo: true, name: true },
        });
        return u ? `${u.name} (${u.employeeNo})` : null;
      }
      case "Role":
      case "Department":
      case "Announcement":
      case "Dictionary":
      case "WorkflowTemplate":
        return null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.OPERATION_LOG, ACTION.READ);
      const { id } = paramsSchema.parse(await params);

      const log = await prisma.operationLog.findUnique({
        where: { id },
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
      });
      if (!log) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, "日志不存在", 404);
      }

      const isSystem = isSystemUser(log.actorId);
      const actor = isSystem
        ? {
            id: SYSTEM_USER_ID,
            name: "系统",
            employeeNo: "SYSTEM",
            email: null,
            isSystem: true,
          }
        : await prisma.user
            .findUnique({
              where: { id: log.actorId },
              select: { id: true, name: true, employeeNo: true, email: true },
            })
            .then((u) => (u ? { ...u, isSystem: false } : null));

      const entityDisplay =
        (await lookupEntityLabel(log.entity, log.entityId)) ?? log.entityId;

      return ok({
        ...log,
        actor,
        entityLabel: entityLabel(log.entity),
        entityHref: entityHref(log.entity, log.entityId),
        entityDisplay,
      });
    } catch (e) {
      return err(e);
    }
  });
}
