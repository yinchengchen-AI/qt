// 合同维度操作日志：合同自身 + 该合同下的开票/回款 涉及的所有 OperationLog
// 权限校验在 service 入口处做：CONTRACT.READ；SALES 通过 ownerEq 在合同存在性查询里
// 隔离（越权访问非自己的合同直接 404，不泄漏存在性）。
//
// 提取到 service 是为了 (1) 跟 overview.ts 等其它 contract service 保持同样分层，
// (2) tests/api/contract-operation-logs.test.ts 可直接 import 本函数跑单测。
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SYSTEM_USER_ID, isSystemUser } from "@/lib/system";
import { entityLabel, entityHref } from "@/lib/operation-log-format";
import { ownerEq } from "@/lib/ownership";
import type { Prisma } from "@prisma/client";

export type ContractOperationLog = {
  id: string;
  actorId: string;
  actor:
    | { id: string; name: string; employeeNo: string; email: string | null; isSystem: true }
    | { id: string; name: string; employeeNo: string; email: string | null; isSystem: false }
    | null;
  action: string;
  entity: string;
  entityId: string;
  diff: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  method: string | null;
  path: string | null;
  status: "SUCCESS" | "FAILURE";
  errorMessage: string | null;
  at: string;
  entityLabel: string;
  entityHref: string | null;
};

export type ContractOperationLogPage = {
  list: ContractOperationLog[];
  total: number;
  page: number;
  pageSize: number;
};

export async function getContractOperationLogs(
  user: SessionUser,
  contractId: string,
  opts: { page: number; pageSize: number },
): Promise<ContractOperationLogPage> {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);

  // 合同存在性 + 行级隔离；SALES 越权访问非自己的合同直接 404
  const c = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null, ...ownerEq(user) },
    select: { id: true },
  });
  if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);

  // 收集该合同下的开票/回款 id，作为 OR 的额外分支
  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: { contractId, deletedAt: null },
      select: { id: true },
    }),
    prisma.payment.findMany({
      where: { contractId, deletedAt: null },
      select: { id: true },
    }),
  ]);
  const invoiceIds = invoices.map((i) => i.id);
  const paymentIds = payments.map((p) => p.id);

  const where: Prisma.OperationLogWhereInput = {
    OR: [
      { entity: "Contract", entityId: contractId },
      ...(invoiceIds.length > 0
        ? [{ entity: "Invoice" as const, entityId: { in: invoiceIds } }]
        : []),
      ...(paymentIds.length > 0
        ? [{ entity: "Payment" as const, entityId: { in: paymentIds } }]
        : []),
    ],
  };

  const [list, total] = await Promise.all([
    prisma.operationLog.findMany({
      where,
      orderBy: { at: "desc" },
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
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

  // 一次拉所有相关 actor
  const actorIds = Array.from(new Set(list.map((l) => l.actorId)));
  const actors =
    actorIds.length > 0 && actorIds.some((id) => !isSystemUser(id))
      ? await prisma.user.findMany({
          where: { id: { in: actorIds.filter((id) => !isSystemUser(id)) } },
          select: { id: true, name: true, employeeNo: true, email: true },
        })
      : [];
  const actorMap = new Map(actors.map((a) => [a.id, a]));

  const enriched: ContractOperationLog[] = list.map((l) => {
    const isSystem = isSystemUser(l.actorId);
    return {
      ...l,
      at: l.at.toISOString(),
      actor: isSystem
        ? {
            id: SYSTEM_USER_ID,
            name: "系统",
            employeeNo: "SYSTEM",
            email: null,
            isSystem: true,
          }
        : actorMap.get(l.actorId)
          ? { ...actorMap.get(l.actorId)!, isSystem: false }
          : null,
      entityLabel: entityLabel(l.entity),
      entityHref: entityHref(l.entity, l.entityId),
      // prisma 把 status 当 string 返；运行时值只有 SUCCESS / FAILURE，向上收窄
      status: (l.status === "FAILURE" ? "FAILURE" : "SUCCESS") as ContractOperationLog["status"],
    };
  });

  return {
    list: enriched,
    total,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}
