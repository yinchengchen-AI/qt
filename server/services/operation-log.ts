// 全局操作日志查询 service（仅 ADMIN，权限在入口处校验）
//
// 提到 service 层是为了 (1) 路由保持薄壳，与 contract/operation-logs.ts 同分层，
// (2) tests/ 可直接 import 本模块跑单测（纯函数 buildOperationLogWhere 无 DB 依赖）。
//
// 能力：
//   - listOperationLogs:  分页 + entity/action/actorId/entityId/ip/status/keyword/时间范围过滤，
//                         keyword 除 对象ID/路径/请求ID/失败原因 外还命中关联实体可读名
//                         （合同号/合同标题/客户编号/客户名/发票号/回款号/用户名/工号），
//                         支持 at/action/entity 白名单排序（默认 at desc，id 做分页稳定兜底），
//                         行内补 actor 信息 + 关联实体可读名（entityDisplay）+ 详情跳转（entityHref）
//   - getOperationLogMeta: 过滤下拉元数据（日志里真实出现过的 entity / action / actor）
//   - getOperationLogDetail: 单条详情（含关联实体可读名 best-effort 查找）
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SYSTEM_USER_ID, isSystemUser } from "@/lib/system";
import { entityLabel, entityHref } from "@/lib/operation-log-format";
import type { Prisma } from "@prisma/client";

export type OperationLogQuery = {
  page: number;
  pageSize: number;
  entity?: string;
  action?: string;
  actorId?: string;
  entityId?: string;
  ip?: string;
  status?: "SUCCESS" | "FAILURE";
  /** 模糊关键字：匹配 对象ID / 请求路径 / 请求ID / 失败原因 + 关联实体可读名（不区分大小写） */
  keyword?: string;
  /** 排序字段白名单，缺省 at */
  sortBy?: "at" | "action" | "entity";
  /** 排序方向，缺省 desc */
  sortOrder?: "asc" | "desc";
  from?: Date;
  to?: Date;
};

export type OperationLogActor =
  | { id: string; name: string; employeeNo: string; email: string | null; isSystem: true }
  | { id: string; name: string; employeeNo: string; email: string | null; isSystem: false }
  | null;

export type OperationLogRow = {
  id: string;
  actorId: string;
  actor: OperationLogActor;
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
  /** 关联实体的可读名（合同号 / 客户名 / 发票号 / 回款号…），查不到回退 entityId */
  entityDisplay: string;
};

export type OperationLogPage = {
  list: OperationLogRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** 纯函数：查询参数 -> Prisma where。导出供单测直接断言 */
export function buildOperationLogWhere(
  p: Omit<OperationLogQuery, "page" | "pageSize">,
): Prisma.OperationLogWhereInput {
  return {
    ...(p.entity ? { entity: p.entity } : {}),
    ...(p.action ? { action: p.action } : {}),
    ...(p.actorId ? { actorId: p.actorId } : {}),
    ...(p.entityId ? { entityId: p.entityId } : {}),
    ...(p.ip ? { ip: { contains: p.ip } } : {}),
    ...(p.status ? { status: p.status } : {}),
    ...(p.keyword
      ? {
          OR: [
            { entityId: { contains: p.keyword, mode: "insensitive" as const } },
            { path: { contains: p.keyword, mode: "insensitive" as const } },
            { requestId: { contains: p.keyword, mode: "insensitive" as const } },
            { errorMessage: { contains: p.keyword, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(p.from || p.to
      ? {
          at: {
            ...(p.from ? { gte: p.from } : {}),
            ...(p.to ? { lte: p.to } : {}),
          },
        }
      : {}),
  };
}

/** 纯函数：排序参数 -> Prisma orderBy（白名单 at/action/entity，id 做分页稳定兜底）。导出供单测直接断言 */
export function buildOperationLogOrderBy(
  p: Pick<OperationLogQuery, "sortBy" | "sortOrder">,
): Prisma.OperationLogOrderByWithRelationInput[] {
  const order = p.sortOrder === "asc" ? ("asc" as const) : ("desc" as const);
  const primary: Prisma.OperationLogOrderByWithRelationInput =
    p.sortBy === "action"
      ? { action: order }
      : p.sortBy === "entity"
        ? { entity: order }
        : { at: order };
  return [primary, { id: order }];
}

// 单次 keyword 可读名解析的每类实体 id 上限,防止 in 列表过大
const DISPLAY_MATCH_TAKE = 200;

/** keyword 命中关联实体可读名时,解析出对应 (entity, entityId in ...) 条件并入 keyword 的 OR */
async function resolveDisplayMatchConditions(
  keyword: string,
): Promise<Prisma.OperationLogWhereInput[]> {
  const contains = { contains: keyword, mode: "insensitive" as const };
  const [contracts, customers, invoices, payments, users] = await Promise.all([
    prisma.contract.findMany({
      where: { OR: [{ contractNo: contains }, { title: contains }] },
      select: { id: true },
      take: DISPLAY_MATCH_TAKE,
    }),
    prisma.customer.findMany({
      where: { OR: [{ code: contains }, { name: contains }] },
      select: { id: true },
      take: DISPLAY_MATCH_TAKE,
    }),
    prisma.invoice.findMany({
      where: { invoiceNo: contains },
      select: { id: true },
      take: DISPLAY_MATCH_TAKE,
    }),
    prisma.payment.findMany({
      where: { paymentNo: contains },
      select: { id: true },
      take: DISPLAY_MATCH_TAKE,
    }),
    prisma.user.findMany({
      where: { OR: [{ name: contains }, { employeeNo: contains }] },
      select: { id: true },
      take: DISPLAY_MATCH_TAKE,
    }),
  ]);
  const conds: Prisma.OperationLogWhereInput[] = [];
  const push = (entity: string, ids: string[]) => {
    if (ids.length > 0) conds.push({ entity, entityId: { in: ids } });
  };
  push("Contract", contracts.map((r) => r.id));
  push("Customer", customers.map((r) => r.id));
  push("Invoice", invoices.map((r) => r.id));
  push("Payment", payments.map((r) => r.id));
  push("User", users.map((r) => r.id));
  return conds;
}

const ROW_SELECT = {
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
} satisfies Prisma.OperationLogSelect;

type RawRow = Prisma.OperationLogGetPayload<{ select: typeof ROW_SELECT }>;

function toActor(
  actorId: string,
  actorMap: Map<string, { id: string; name: string; employeeNo: string; email: string | null }>,
): OperationLogActor {
  if (isSystemUser(actorId)) {
    return {
      id: SYSTEM_USER_ID,
      name: "系统",
      employeeNo: "SYSTEM",
      email: null,
      isSystem: true,
    };
  }
  const u = actorMap.get(actorId);
  return u ? { ...u, isSystem: false } : null;
}

async function loadActorMap(actorIds: string[]) {
  const humanIds = Array.from(new Set(actorIds)).filter((id) => !isSystemUser(id));
  const actors =
    humanIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: humanIds } },
          select: { id: true, name: true, employeeNo: true, email: true },
        })
      : [];
  return new Map(actors.map((a) => [a.id, a]));
}

/** 批量解析 entityDisplay：按 entity 分组一次查询，避免逐行 N+1 */
async function loadEntityDisplays(
  rows: { entity: string; entityId: string }[],
): Promise<Map<string, string>> {
  const key = (e: string, id: string) => `${e}:${id}`;
  const idsOf = (entity: string) =>
    Array.from(
      new Set(rows.filter((r) => r.entity === entity).map((r) => r.entityId)),
    );
  const out = new Map<string, string>();

  const [contracts, customers, invoices, payments, users] = await Promise.all([
    idsOf("Contract").length > 0
      ? prisma.contract.findMany({
          where: { id: { in: idsOf("Contract") } },
          select: { id: true, contractNo: true, title: true },
        })
      : [],
    idsOf("Customer").length > 0
      ? prisma.customer.findMany({
          where: { id: { in: idsOf("Customer") } },
          select: { id: true, code: true, name: true },
        })
      : [],
    idsOf("Invoice").length > 0
      ? prisma.invoice.findMany({
          where: { id: { in: idsOf("Invoice") } },
          select: { id: true, invoiceNo: true },
        })
      : [],
    idsOf("Payment").length > 0
      ? prisma.payment.findMany({
          where: { id: { in: idsOf("Payment") } },
          select: { id: true, paymentNo: true },
        })
      : [],
    idsOf("User").length > 0
      ? prisma.user.findMany({
          where: { id: { in: idsOf("User") } },
          select: { id: true, name: true, employeeNo: true },
        })
      : [],
  ]);

  for (const c of contracts) out.set(key("Contract", c.id), `${c.contractNo} ${c.title}`);
  for (const c of customers) out.set(key("Customer", c.id), `${c.code} ${c.name}`);
  for (const i of invoices) out.set(key("Invoice", i.id), i.invoiceNo);
  for (const p of payments) out.set(key("Payment", p.id), p.paymentNo);
  for (const u of users) out.set(key("User", u.id), `${u.name} (${u.employeeNo})`);
  return out;
}

function enrichRows(
  list: RawRow[],
  actorMap: Map<string, { id: string; name: string; employeeNo: string; email: string | null }>,
  displayMap: Map<string, string>,
): OperationLogRow[] {
  return list.map((l) => ({
    ...l,
    at: l.at.toISOString(),
    actor: toActor(l.actorId, actorMap),
    entityLabel: entityLabel(l.entity),
    entityHref: entityHref(l.entity, l.entityId),
    entityDisplay: displayMap.get(`${l.entity}:${l.entityId}`) ?? l.entityId,
    // prisma 把 status 当 string 返；运行时值只有 SUCCESS / FAILURE，向上收窄
    status: (l.status === "FAILURE" ? "FAILURE" : "SUCCESS") as OperationLogRow["status"],
  }));
}

export async function listOperationLogs(
  user: SessionUser,
  p: OperationLogQuery,
): Promise<OperationLogPage> {
  requirePermission(user.roleCode, RESOURCE.OPERATION_LOG, ACTION.READ);
  const where = buildOperationLogWhere(p);
  if (p.keyword) {
    // keyword 额外命中关联实体可读名(合同号/客户名/发票号等),并入同一个 OR
    const extra = await resolveDisplayMatchConditions(p.keyword);
    if (extra.length > 0) {
      const or = Array.isArray(where.OR) ? where.OR : [];
      where.OR = [...or, ...extra];
    }
  }
  const [list, total] = await Promise.all([
    prisma.operationLog.findMany({
      where,
      orderBy: buildOperationLogOrderBy(p),
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
      select: ROW_SELECT,
    }),
    prisma.operationLog.count({ where }),
  ]);
  const [actorMap, displayMap] = await Promise.all([
    loadActorMap(list.map((l) => l.actorId)),
    loadEntityDisplays(list),
  ]);
  return {
    list: enrichRows(list, actorMap, displayMap),
    total,
    page: p.page,
    pageSize: p.pageSize,
  };
}

// =====================================================
// 过滤元数据：日志里真实出现过的 entity / action / actor
// =====================================================
export type OperationLogMeta = {
  entities: { value: string; label: string }[];
  actions: { value: string; label: string }[];
  actors: { value: string; label: string; isSystem: boolean }[];
};

export async function getOperationLogMeta(user: SessionUser): Promise<OperationLogMeta> {
  requirePermission(user.roleCode, RESOURCE.OPERATION_LOG, ACTION.READ);
  const [entityRows, actionRows, actorRows] = await Promise.all([
    prisma.operationLog.findMany({ distinct: ["entity"], select: { entity: true } }),
    prisma.operationLog.findMany({
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
    }),
    prisma.operationLog.findMany({ distinct: ["actorId"], select: { actorId: true } }),
  ]);
  const actorMap = await loadActorMap(actorRows.map((r) => r.actorId));

  return {
    entities: entityRows
      .map((r) => r.entity)
      .sort()
      .map((e) => ({ value: e, label: entityLabel(e) })),
    actions: actionRows.map((r) => ({ value: r.action, label: r.action })),
    actors: actorRows
      .map((r) => r.actorId)
      .sort()
      .map((id) => {
        const a = toActor(id, actorMap);
        return {
          value: id,
          label: a ? (a.isSystem ? "系统（自动任务）" : `${a.name} (${a.employeeNo})`) : id,
          isSystem: a?.isSystem ?? false,
        };
      }),
  };
}

// =====================================================
// 单条详情
// =====================================================
export type OperationLogDetail = OperationLogRow;

/** 单条详情的实体可读名查找；找不到回退 null（前端显示 entityId） */
async function lookupEntityDisplay(
  entity: string,
  entityId: string,
): Promise<string | null> {
  try {
    const map = await loadEntityDisplays([{ entity, entityId }]);
    return map.get(`${entity}:${entityId}`) ?? null;
  } catch {
    return null;
  }
}

export async function getOperationLogDetail(
  user: SessionUser,
  id: string,
): Promise<OperationLogDetail> {
  requirePermission(user.roleCode, RESOURCE.OPERATION_LOG, ACTION.READ);
  const log = await prisma.operationLog.findUnique({
    where: { id },
    select: ROW_SELECT,
  });
  if (!log) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, "日志不存在", 404);
  }
  const [actorMap, display] = await Promise.all([
    loadActorMap([log.actorId]),
    lookupEntityDisplay(log.entity, log.entityId),
  ]);
  return enrichRows(
    [log],
    actorMap,
    new Map(display ? [[`${log.entity}:${log.entityId}`, display]] : []),
  )[0]!;
}
