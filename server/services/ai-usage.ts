// AI 用量统计查询 service (仅 ADMIN, 复用 OPERATION_LOG READ 权限, 入口校验)
//
// 能力:
//   - listAiUsageLogs: 分页 + feature/userKeyword(姓名/工号)/status/cacheHit/时间范围过滤,
//                      行内补 user 姓名/工号 (系统调用显示"系统");
//                      同一次查询返回 summary 汇总 (总调用/缓存命中率/token 合计/估算成本/失败数/平均耗时),
//                      汇总与列表用同一 where, 前端改过滤即得对应口径。
//   - buildAiUsageWhere: 纯函数, 查询参数 -> Prisma where, 供单测直接断言。
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { SYSTEM_USER_ID, isSystemUser } from "@/lib/system";
import type { Prisma } from "@prisma/client";

export type AiUsageQuery = {
  page: number;
  pageSize: number;
  feature?: string;
  status?: "SUCCESS" | "FAILURE";
  cacheHit?: boolean;
  /** 姓名/工号模糊匹配, 解析成 userId 列表后过滤 */
  userKeyword?: string;
  from?: Date;
  to?: Date;
};

export type AiUsageRow = {
  id: string;
  feature: string;
  userId: string;
  userName: string;
  userEmployeeNo: string;
  model: string;
  cacheHit: boolean;
  promptTokens: number;
  completionTokens: number;
  /** USD, 估算口径 (见 ai-client.ts 单价常量); 缓存命中/失败为 null */
  costEstimate: number | null;
  latencyMs: number;
  status: "SUCCESS" | "FAILURE";
  errorMessage: string | null;
  requestId: string | null;
  createdAt: string;
};

export type AiUsageSummary = {
  totalCalls: number;
  cacheHitCount: number;
  /** 0-100 整数百分比; 无数据为 0 */
  cacheHitRate: number;
  failureCount: number;
  promptTokens: number;
  completionTokens: number;
  /** USD 合计 (6 位小数) */
  costEstimate: number;
  avgLatencyMs: number;
};

export type AiUsagePage = {
  list: AiUsageRow[];
  total: number;
  page: number;
  pageSize: number;
  summary: AiUsageSummary;
};

/** 纯函数: 查询参数 -> Prisma where (userKeyword 已在外层解析成 userIds 后并入)。导出供单测断言 */
export function buildAiUsageWhere(
  p: Omit<AiUsageQuery, "page" | "pageSize" | "userKeyword"> & { userIds?: string[] },
): Prisma.AiUsageLogWhereInput {
  return {
    ...(p.feature ? { feature: p.feature } : {}),
    ...(p.status ? { status: p.status } : {}),
    ...(p.cacheHit === undefined ? {} : { cacheHit: p.cacheHit }),
    ...(p.userIds ? { userId: { in: p.userIds } } : {}),
    ...(p.from || p.to
      ? {
          createdAt: {
            ...(p.from ? { gte: p.from } : {}),
            ...(p.to ? { lte: p.to } : {}),
          },
        }
      : {}),
  };
}

const ROW_SELECT = {
  id: true,
  feature: true,
  userId: true,
  model: true,
  cacheHit: true,
  promptTokens: true,
  completionTokens: true,
  costEstimate: true,
  latencyMs: true,
  status: true,
  errorMessage: true,
  requestId: true,
  createdAt: true,
} satisfies Prisma.AiUsageLogSelect;

/** userKeyword (姓名/工号 contains) -> userId 列表; 无命中返回空数组 (外层会得到空结果) */
async function resolveUserIds(keyword: string): Promise<string[]> {
  const contains = { contains: keyword, mode: "insensitive" as const };
  const users = await prisma.user.findMany({
    where: { OR: [{ name: contains }, { employeeNo: contains }] },
    select: { id: true },
    take: 200,
  });
  return users.map((u) => u.id);
}

export async function listAiUsageLogs(user: SessionUser, p: AiUsageQuery): Promise<AiUsagePage> {
  requirePermission(user.roleCode, RESOURCE.OPERATION_LOG, ACTION.READ);

  let userIds: string[] | undefined;
  if (p.userKeyword) {
    userIds = await resolveUserIds(p.userKeyword);
    if (userIds.length === 0) userIds = ["__no_match__"]; // 短路: 保证空结果而不是误放行全量
  }
  const where = buildAiUsageWhere({ ...p, userIds });

  const [list, total, agg, cacheHitCount, failureCount] = await Promise.all([
    prisma.aiUsageLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (p.page - 1) * p.pageSize,
      take: p.pageSize,
      select: ROW_SELECT,
    }),
    prisma.aiUsageLog.count({ where }),
    prisma.aiUsageLog.aggregate({
      where,
      _sum: { promptTokens: true, completionTokens: true, costEstimate: true },
      _avg: { latencyMs: true },
    }),
    prisma.aiUsageLog.count({ where: { ...where, cacheHit: true } }),
    prisma.aiUsageLog.count({ where: { ...where, status: "FAILURE" } }),
  ]);

  // 行内补用户信息 (系统调用显示"系统")
  const humanIds = Array.from(new Set(list.map((r) => r.userId))).filter((id) => !isSystemUser(id));
  const users =
    humanIds.length > 0
      ? await prisma.user.findMany({
          where: { id: { in: humanIds } },
          select: { id: true, name: true, employeeNo: true },
        })
      : [];
  const userMap = new Map(users.map((u) => [u.id, u]));

  const rows: AiUsageRow[] = list.map((r) => {
    const u = userMap.get(r.userId);
    const system = isSystemUser(r.userId) || r.userId === SYSTEM_USER_ID;
    return {
      ...r,
      userName: system ? "系统" : (u?.name ?? r.userId),
      userEmployeeNo: system ? "SYSTEM" : (u?.employeeNo ?? ""),
      // prisma Decimal -> number (USD, 6 位小数)
      costEstimate: r.costEstimate === null ? null : Number(r.costEstimate),
      status: (r.status === "FAILURE" ? "FAILURE" : "SUCCESS") as AiUsageRow["status"],
      createdAt: r.createdAt.toISOString(),
    };
  });

  return {
    list: rows,
    total,
    page: p.page,
    pageSize: p.pageSize,
    summary: {
      totalCalls: total,
      cacheHitCount,
      cacheHitRate: total > 0 ? Math.round((cacheHitCount / total) * 100) : 0,
      failureCount,
      promptTokens: agg._sum.promptTokens ?? 0,
      completionTokens: agg._sum.completionTokens ?? 0,
      costEstimate: agg._sum.costEstimate === null ? 0 : Number(agg._sum.costEstimate),
      avgLatencyMs: Math.round(agg._avg.latencyMs ?? 0),
    },
  };
}
