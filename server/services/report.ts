// 报表中心服务：报表定义管理、快照生成/重生成、自定义范围实时查询
import { prisma } from "@/lib/prisma";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { DateRange } from "@/lib/date-range";
import {
  getOverview,
  getTimeSeries,
  getEmployeePerformance,
  getRegionStatistics,
  getTopCustomers,
  getInvoiceAging,
  getSignerContractDetail,
} from "@/server/services/statistics";
import { createHash } from "crypto";
import { z } from "zod";
import { REPORT_COLUMN_LABELS } from "@/lib/report-labels";

export type ReportType = "FINANCIAL" | "BUSINESS" | "PERFORMANCE" | "CUSTOM";
export type ReportPeriodType = "MONTH" | "QUARTER" | "YEAR" | "CUSTOM";
export type SnapshotStatus = "PENDING" | "READY" | "FAILED" | "STALE";

export const ReportMetricSchema = z.object({
  key: z.string(),
  label: z.string(),
  unit: z.string(),
});
export type ReportMetric = z.infer<typeof ReportMetricSchema>;
export type ReportDimension = string;

export type ReportDefinitionItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: ReportType;
  periodType: ReportPeriodType;
  defaultMetrics: ReportMetric[];
  dimensions: ReportDimension[];
  isActive: boolean;
  sortOrder: number;
};

export type ReportSnapshotItem = {
  id: string;
  definitionCode: string;
  definitionName: string;
  periodType: ReportPeriodType;
  periodLabel: string;
  from: Date;
  to: Date;
  status: SnapshotStatus;
  generatedAt: Date;
  generatedByName: string;
};

export type ReportPayload = {
  overview?: Record<string, number>;
  series?: Array<Record<string, unknown>>;
  performance?: Array<Record<string, unknown>>;
  region?: Array<Record<string, unknown>>;
  topCustomers?: Array<Record<string, unknown>>;
  aging?: Array<Record<string, unknown>>;
  dimensions?: Record<string, unknown>;
  /**
   * PERFORMANCE 报表专属:按签约人汇总的合同级明细。
   * 字段:所属区域(district+town) / 企业名称 / 服务项目 / 签约人 / 合同金额,
   * 对应 2026年5月业务明细.pdf 模板。每组带 subtotalWan 字段,用于表格右侧小计。
   */
  signerDetail?: Array<Record<string, unknown>>;
};

export type ReportResult = {
  snapshotId?: string;
  definition: ReportDefinitionItem;
  periodType: ReportPeriodType;
  periodLabel: string;
  from: Date;
  to: Date;
  status: SnapshotStatus;
  payload: ReportPayload;
  generatedAt?: Date;
  hash?: string;
};

function assertRead(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.REPORT_CENTER, ACTION.READ);
}

function assertUpdate(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.REPORT_CENTER, ACTION.UPDATE);
}

function assertDelete(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.REPORT_CENTER, ACTION.DELETE);
}

export function assertExportPermission(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.REPORT_CENTER, ACTION.EXPORT);
}

export function toDefItem(row: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: string;
  periodType: string;
  defaultMetrics: unknown;
  dimensions: unknown;
  isActive: boolean;
  sortOrder: number;
}): ReportDefinitionItem {
  const metrics = z.array(ReportMetricSchema).safeParse(row.defaultMetrics);
  const dimensions = z.array(z.string()).safeParse(row.dimensions);
  if (!metrics.success) {
    console.warn(`[report] definition ${row.code} has invalid defaultMetrics`, metrics.error);
  }
  if (!dimensions.success) {
    console.warn(`[report] definition ${row.code} has invalid dimensions`, dimensions.error);
  }
  return {
    ...row,
    type: row.type as ReportType,
    periodType: row.periodType as ReportPeriodType,
    defaultMetrics: metrics.success ? metrics.data : [],
    dimensions: dimensions.success ? dimensions.data : [],
  };
}

/** 计算周期对应的日期范围和展示标签 */
export function resolvePeriod(
  periodType: ReportPeriodType,
  reference?: Date
): { periodLabel: string; from: Date; to: Date } {
  const now = reference ?? new Date();
  const year = now.getFullYear();

  if (periodType === "MONTH") {
    const month = now.getMonth();
    const label = `${year}年${month + 1}月`;
    const from = new Date(year, month, 1, 0, 0, 0, 0);
    const to = new Date(year, month + 1, 0, 23, 59, 59, 999);
    return { periodLabel: label, from, to };
  }

  if (periodType === "QUARTER") {
    const quarter = Math.floor(now.getMonth() / 3);
    const from = new Date(year, quarter * 3, 1, 0, 0, 0, 0);
    const to = new Date(year, (quarter + 1) * 3, 0, 23, 59, 59, 999);
    return { periodLabel: `${year}年Q${quarter + 1}`, from, to };
  }

  if (periodType === "YEAR") {
    const from = new Date(year, 0, 1, 0, 0, 0, 0);
    const to = new Date(year, 11, 31, 23, 59, 59, 999);
    return { periodLabel: `${year}年`, from, to };
  }

  // CUSTOM 默认本月，调用方应传入自定义范围
  return resolvePeriod("MONTH", now);
}

/** 按参考日期倒退一个周期，用于定时任务生成“上一个”周期快照 */
export function previousPeriod(
  periodType: Exclude<ReportPeriodType, "CUSTOM">,
  reference?: Date
): { periodLabel: string; from: Date; to: Date } {
  const now = reference ?? new Date();
  if (periodType === "MONTH") {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return resolvePeriod("MONTH", d);
  }
  if (periodType === "QUARTER") {
    const currentQuarter = Math.floor(now.getMonth() / 3);
    const year = currentQuarter === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const month = currentQuarter === 0 ? 9 : (currentQuarter - 1) * 3;
    return resolvePeriod("QUARTER", new Date(year, month, 1));
  }
  return resolvePeriod("YEAR", new Date(now.getFullYear() - 1, 0, 1));
}

/** 判断当前日期是否适合生成某周期的快照（避免季/年报每月都被刷新） */
export function shouldGeneratePeriod(
  periodType: Exclude<ReportPeriodType, "CUSTOM">,
  now = new Date()
): boolean {
  const day = now.getDate();
  if (day !== 1) return false;
  if (periodType === "MONTH") return true;
  const month = now.getMonth();
  if (periodType === "QUARTER") return month % 3 === 0;
  return month === 0;
}

/** 把 DateRange 转成展示标签 */
export function customPeriodLabel(from: Date, to: Date): string {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${fmt(from)} ~ ${fmt(to)}`;
}

/** 计算源数据版本 hash：取关键表最近更新时间 + 日期范围 */
export async function computeSourceHash(range: DateRange): Promise<string> {
  const [contractMax, invoiceMax, paymentMax, customerMax] = await Promise.all([
    prisma.contract.aggregate({ where: { deletedAt: null }, _max: { updatedAt: true } }),
    prisma.invoice.aggregate({ where: { deletedAt: null }, _max: { updatedAt: true } }),
    prisma.payment.aggregate({ where: { deletedAt: null }, _max: { updatedAt: true } }),
    prisma.customer.aggregate({ where: { deletedAt: null }, _max: { updatedAt: true } }),
  ]);
  const source = JSON.stringify({
    c: contractMax._max.updatedAt?.toISOString(),
    i: invoiceMax._max.updatedAt?.toISOString(),
    p: paymentMax._max.updatedAt?.toISOString(),
    u: customerMax._max.updatedAt?.toISOString(),
    from: range.from?.toISOString(),
    to: range.to?.toISOString(),
  });
  return createHash("md5").update(source).digest("hex");
}

async function findDefinition(code: string): Promise<ReportDefinitionItem> {
  const row = await prisma.reportDefinition.findUnique({
    where: { code, deletedAt: null },
  });
  if (!row) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, `报表模板 ${code} 不存在`, 404);
  }
  return toDefItem(row);
}

export async function aggregatePayload(
  user: SessionUser,
  definition: ReportDefinitionItem,
  range: DateRange
): Promise<ReportPayload> {
  const type = definition.type;
  const payload: ReportPayload = {};

  if (type === "FINANCIAL") {
    const [overview, series, aging] = await Promise.all([
      getOverview(user, range),
      getTimeSeries(user, range),
      getInvoiceAging(user, { basis: "due", pageSize: 1000, from: range.from, to: range.to }),
    ]);
    payload.overview = overview;
    payload.series = series;
    payload.aging = aging.rows;
    payload.dimensions = { basis: aging.basisUsed };
  } else if (type === "BUSINESS") {
    const [overview, series, region] = await Promise.all([
      getOverview(user, range),
      getTimeSeries(user, range),
      getRegionStatistics(user, range),
    ]);
    payload.overview = overview;
    payload.series = series;
    payload.region = region;
  } else if (type === "PERFORMANCE") {
    const [overview, performance, signerDetail] = await Promise.all([
      getOverview(user, range),
      getEmployeePerformance(user, undefined, range),
      getSignerContractDetail(user, range),
    ]);
    payload.overview = overview;
    payload.performance = performance;
    payload.signerDetail = signerDetail as unknown as Array<Record<string, unknown>>;
  } else if (type === "CUSTOM") {
    const [overview, series, region, performance, topCustomers, aging] = await Promise.all([
      getOverview(user, range),
      getTimeSeries(user, range),
      getRegionStatistics(user, range),
      getEmployeePerformance(user, undefined, range),
      getTopCustomers(user, "contract", 20, range),
      getInvoiceAging(user, { basis: "due", pageSize: 1000, from: range.from, to: range.to }),
    ]);
    payload.overview = overview;
    payload.series = series;
    payload.region = region;
    payload.performance = performance;
    payload.topCustomers = topCustomers;
    payload.aging = aging.rows;
  }

  return payload;
}

/** 公共入口：查询快照；不存在或数据已过期则重新生成（非 CUSTOM 周期） */
export async function getOrBuildSnapshot(
  user: SessionUser,
  code: string,
  periodType: ReportPeriodType,
  customRange?: DateRange
): Promise<ReportResult> {
  assertRead(user);
  const definition = await findDefinition(code);

  if (periodType === "CUSTOM") {
    if (!customRange?.from || !customRange?.to) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "自定义周期必须提供 from/to", 400);
    }
    const payload = await aggregatePayload(user, definition, customRange);
    return {
      definition,
      periodType: "CUSTOM",
      periodLabel: customPeriodLabel(customRange.from, customRange.to),
      from: customRange.from,
      to: customRange.to,
      status: "READY",
      payload,
    };
  }

  const { periodLabel, from, to } = resolvePeriod(periodType);
  const range: DateRange = { from, to };

  const existing = await prisma.reportSnapshot.findUnique({
    where: {
      definitionId_periodType_periodLabel: {
        definitionId: definition.id,
        periodType,
        periodLabel,
      },
    },
  });

  // 如果存在 READY 快照，校验源数据 hash 是否变化；未变化直接返回
  if (existing && existing.status === "READY" && existing.deletedAt === null) {
    const currentHash = await computeSourceHash(range);
    if (existing.hash === currentHash) {
      return {
        snapshotId: existing.id,
        definition,
        periodType: existing.periodType as ReportPeriodType,
        periodLabel: existing.periodLabel,
        from: existing.from,
        to: existing.to,
        status: "READY",
        payload: existing.payload as ReportPayload,
        generatedAt: existing.generatedAt,
        hash: existing.hash ?? undefined,
      };
    }
  }

  // 未命中、状态非 READY 或 hash 已变化：同步重新生成并落库
  // 注：当前为同步生成；数据量较大时可能超时，后续可改为异步 PENDING + 轮询
  const payload = await aggregatePayload(user, definition, range);
  const hash = await computeSourceHash(range);
  const upsertData = {
    definitionId: definition.id,
    periodType,
    periodLabel,
    from,
    to,
    status: "READY" as const,
    payload: payload as object,
    hash,
    generatedById: user.id,
    generatedAt: new Date(),
  };

  const snapshot = existing
    ? await prisma.reportSnapshot.update({
        where: { id: existing.id },
        data: upsertData,
      })
    : await prisma.reportSnapshot.create({ data: upsertData });

  return {
    snapshotId: snapshot.id,
    definition,
    periodType: snapshot.periodType as ReportPeriodType,
    periodLabel: snapshot.periodLabel,
    from: snapshot.from,
    to: snapshot.to,
    status: "READY",
    payload: snapshot.payload as ReportPayload,
    generatedAt: snapshot.generatedAt,
    hash: snapshot.hash ?? undefined,
  };
}

/** 手动重新生成快照 */
export async function regenerateSnapshot(user: SessionUser, snapshotId: string): Promise<ReportResult> {
  assertUpdate(user);
  const snapshot = await prisma.reportSnapshot.findUnique({
    where: { id: snapshotId, deletedAt: null },
    include: { definition: true },
  });
  if (!snapshot) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, "快照不存在", 404);
  }
  const definition = toDefItem(snapshot.definition);
  const range: DateRange = { from: snapshot.from, to: snapshot.to };
  const payload = await aggregatePayload(user, definition, range);
  const hash = await computeSourceHash(range);

  const updated = await prisma.reportSnapshot.update({
    where: { id: snapshotId },
    data: {
      status: "READY",
      payload: payload as object,
      hash,
      generatedById: user.id,
      generatedAt: new Date(),
    },
  });

  return {
    snapshotId: updated.id,
    definition,
    periodType: updated.periodType as ReportPeriodType,
    periodLabel: updated.periodLabel,
    from: updated.from,
    to: updated.to,
    status: "READY",
    payload: updated.payload as ReportPayload,
    generatedAt: updated.generatedAt,
    hash: updated.hash ?? undefined,
  };
}

/** 列出报表定义 */
export async function listDefinitions(user: SessionUser): Promise<ReportDefinitionItem[]> {
  assertRead(user);
  const rows = await prisma.reportDefinition.findMany({
    where: { isActive: true, deletedAt: null },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map(toDefItem);
}

/** 列出快照（按报表定义分组最新 N 条） */
export async function listSnapshots(
  user: SessionUser,
  options: { definitionCode?: string; periodType?: ReportPeriodType; limit?: number } = {}
): Promise<ReportSnapshotItem[]> {
  assertRead(user);
  const where: Record<string, unknown> = { deletedAt: null };
  if (options.definitionCode) {
    const def = await findDefinition(options.definitionCode);
    where.definitionId = def.id;
  }
  if (options.periodType) {
    where.periodType = options.periodType;
  }

  const rows = await prisma.reportSnapshot.findMany({
    where,
    include: { definition: true, generatedBy: { select: { name: true } } },
    orderBy: { generatedAt: "desc" },
    take: options.limit ?? 50,
  });

  return rows.map((r) => ({
    id: r.id,
    definitionCode: r.definition.code,
    definitionName: r.definition.name,
    periodType: r.periodType as ReportPeriodType,
    periodLabel: r.periodLabel,
    from: r.from,
    to: r.to,
    status: r.status as SnapshotStatus,
    generatedAt: r.generatedAt,
    generatedByName: r.generatedBy.name,
  }));
}

/** 获取单条快照 */
export async function getSnapshot(user: SessionUser, snapshotId: string): Promise<ReportResult> {
  assertRead(user);
  const snapshot = await prisma.reportSnapshot.findUnique({
    where: { id: snapshotId, deletedAt: null },
    include: { definition: true },
  });
  if (!snapshot) {
    throw new ApiError(ERROR_CODES.NOT_FOUND, "快照不存在", 404);
  }
  return {
    snapshotId: snapshot.id,
    definition: toDefItem(snapshot.definition),
    periodType: snapshot.periodType as ReportPeriodType,
    periodLabel: snapshot.periodLabel,
    from: snapshot.from,
    to: snapshot.to,
    status: snapshot.status as SnapshotStatus,
    payload: snapshot.payload as ReportPayload,
    generatedAt: snapshot.generatedAt,
    hash: snapshot.hash ?? undefined,
  };
}

/** 软删除快照 */
export async function deleteSnapshot(user: SessionUser, snapshotId: string): Promise<void> {
  assertDelete(user);
  await prisma.reportSnapshot.update({
    where: { id: snapshotId },
    data: { deletedAt: new Date() },
  });
}

/** 导出快照为 Excel 行数据（供 /api/reports/export 使用） */
export async function prepareExportRows(
  user: SessionUser,
  snapshotId: string
): Promise<{
  definition: ReportDefinitionItem;
  rows: Record<string, unknown>[];
  columns: string[];
  labelMap: Record<string, string>;
}> {
  assertExportPermission(user);
  const result = await getSnapshot(user, snapshotId);
  const payload = result.payload;
  const definition = result.definition;

  // 指标 key -> 中文 label 映射(默认指标 + 通用字段)
  const labelMap: Record<string, string> = { ...REPORT_COLUMN_LABELS };
  for (const m of definition.defaultMetrics) {
    labelMap[m.key] = m.label;
  }

  let rows: Record<string, unknown>[] = [];
  if (definition.type === "PERFORMANCE") {
    rows = (payload.performance ?? []) as Record<string, unknown>[];
  } else if (definition.type === "BUSINESS") {
    rows = (payload.region ?? []) as Record<string, unknown>[];
  } else if (definition.type === "CUSTOM") {
    // 自定义报表优先导出区域统计；无数据则 fallback 到趋势
    rows = ((payload.region?.length ? payload.region : payload.series) ?? []) as Record<string, unknown>[];
  } else {
    // FINANCIAL：导出趋势明细
    rows = (payload.series ?? []) as Record<string, unknown>[];
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]!) : [];
  return { definition, rows, columns, labelMap };
}

/** 定时任务入口：生成上一周期的快照 */
export async function generatePeriodSnapshots(
  now = new Date(),
  actorId = "system"
): Promise<{ created: number; updated: number; skipped: number; failed: number }> {
  const definitions = await prisma.reportDefinition.findMany({
    where: { isActive: true, deletedAt: null, periodType: { not: "CUSTOM" } },
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const def of definitions) {
    try {
      const definition = toDefItem(def);
      const periodType = definition.periodType as Exclude<ReportPeriodType, "CUSTOM">;

      // 按定义自身周期判断当前是否应生成，避免季/年报每月都被刷新
      if (!shouldGeneratePeriod(periodType, now)) {
        skipped++;
        continue;
      }

      const { periodLabel, from, to } = previousPeriod(periodType, now);
      const range: DateRange = { from, to };

      const payload = await buildPayloadForActor(definition, range);
      const hash = await computeSourceHash(range);

      const existing = await prisma.reportSnapshot.findUnique({
        where: {
          definitionId_periodType_periodLabel: {
            definitionId: def.id,
            periodType,
            periodLabel,
          },
        },
      });

      if (existing) {
        await prisma.reportSnapshot.update({
          where: { id: existing.id },
          data: {
            status: "READY",
            payload: payload as object,
            hash,
            generatedById: actorId,
            generatedAt: now,
          },
        });
        updated++;
      } else {
        await prisma.reportSnapshot.create({
          data: {
            definitionId: def.id,
            periodType,
            periodLabel,
            from,
            to,
            status: "READY",
            payload: payload as object,
            hash,
            generatedById: actorId,
            generatedAt: now,
          },
        });
        created++;
      }
    } catch (e) {
      console.error(`[report-snapshot] failed for definition ${def.code}:`, e);
      failed++;
    }
  }

  return { created, updated, skipped, failed };
}

/** 定时任务内部用：不鉴权，直接聚合 */
async function buildPayloadForActor(
  definition: ReportDefinitionItem,
  range: DateRange
): Promise<ReportPayload> {
  // 构造一个虚拟的 SessionUser，用于复用 statistics 服务
  const actor: SessionUser = {
    id: "system",
    employeeNo: "SYSTEM",
    name: "System",
    email: "system@internal.local",
    roleCode: "ADMIN",
    permissions: [],
  };
  return aggregatePayload(actor, definition, range);
}
