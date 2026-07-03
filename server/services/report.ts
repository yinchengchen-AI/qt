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
  getSignerSummary,
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
  /**
   * PERFORMANCE 报表专属:按签约人聚合的业绩汇总(姓名/工号/合同数/合同额/已开票额/已回款额)。
   * 跟 signerDetail 同一维度, 报表导出 Sheet 1 "员工业绩汇总" 走这份, 不再用 owner 维度的 performance。
   */
  signerSummary?: Array<Record<string, unknown>>;
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
    const [overview, performance, signerSummary, signerDetail] = await Promise.all([
      getOverview(user, range),
      getEmployeePerformance(user, undefined, range),
      getSignerSummary(user, range),
      getSignerContractDetail(user, range),
    ]);
    payload.overview = overview;
    payload.performance = performance;
    payload.signerSummary = signerSummary as unknown as Array<Record<string, unknown>>;
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
/**
 * 公共入口（只读）：查询快照。
 * - CUSTOM 周期: 走 live aggregate, 不存快照, 永远能返回 ReportResult (无 snapshotId)
 * - MONTH/QUARTER/YEAR: 仅查表; 找不到抛 ApiError(NOT_FOUND), 引导用户先手动生成
 *
 * 这是渲染报表中心详情页 mount 时的入口, 不再隐式建快照。
 */
export async function findSnapshot(
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

  const { periodLabel } = resolvePeriod(periodType);
  const existing = await prisma.reportSnapshot.findUnique({
    where: {
      definitionId_periodType_periodLabel: {
        definitionId: definition.id,
        periodType,
        periodLabel,
      },
    },
  });
  if (!existing || existing.deletedAt !== null) {
    throw new ApiError(
      ERROR_CODES.NOT_FOUND,
      `该周期未生成报表（${definition.name} / ${periodLabel}）`,
      404
    );
  }
  return {
    snapshotId: existing.id,
    definition,
    periodType: existing.periodType as ReportPeriodType,
    periodLabel: existing.periodLabel,
    from: existing.from,
    to: existing.to,
    status: existing.status as SnapshotStatus,
    payload: existing.payload as ReportPayload,
    generatedAt: existing.generatedAt,
    hash: existing.hash ?? undefined,
  };
}

/**
 * 公共入口（写）：手动生成快照。
 * - 找不到该周期的快照: 全新创建
 * - 找到但源数据 hash 变化: update (重算 payload)
 * - 找到且 hash 一致: skip, 直接返回旧 payload (避免无意义写库)
 * - CUSTOM 周期: 跟 findSnapshot 一样走 live, 不持久化
 *
 * 业务约束: 仅 REPORT_CENTER:UPDATE 权限可调, 报表中心 admin/finance 可以手动生成。
 */
export async function generateSnapshot(
  user: SessionUser,
  code: string,
  periodType: ReportPeriodType,
  customRange?: DateRange
): Promise<ReportResult> {
  assertUpdate(user);
  const definition = await findDefinition(code);

  if (periodType === "CUSTOM") {
    // CUSTOM 不存快照, 走 live, 行为与 findSnapshot 一致
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

  // hash 比对: 数据未变则直接返回旧快照, 不重算
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
/**
 * 准备导出 rows + columns(单 sheet 版本, 给老调用方用)。
 * PERFORMANCE 类型额外带签约明细 (PDF 5 字段), 多个 sheet 由 prepareExportSections 输出。
 */
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
  const { definition, sections } = await prepareExportSections(user, snapshotId);
  // 兼容老用法: 返回第一个 sheet
  const first = sections[0];
  if (!first) {
    return { definition, rows: [], columns: [], labelMap: {} };
  }
  return {
    definition,
    rows: first.rows,
    columns: first.columns.map((c) => c.key),
    labelMap: first.labelMap,
  };
}

export type ExportSection = {
  /** 用于多 sheet 文件的 sheet 名 */
  name: string;
  /** 单 section 的列(中文 label 已映射) */
  columns: Array<{ header: string; key: string; width?: number; formatter?: (v: unknown) => string | number }>;
  rows: Record<string, unknown>[];
  labelMap: Record<string, string>;
};

export type ExportResult = {
  definition: ReportDefinitionItem;
  sections: ExportSection[];
};

/**
 * 把快照 payload 转成导出 sections。PERFORMANCE 走 2 sheets:
 *   1) 员工业绩汇总 (原有 4 字段 summary)
 *   2) 签约明细 (PDF 5 字段, 含签约人小计 + 全公司合计)
 * 其它类型 1 sheet。
 */
export async function prepareExportSections(
  user: SessionUser,
  snapshotId: string
): Promise<ExportResult> {
  assertExportPermission(user);
  const result = await getSnapshot(user, snapshotId);
  const payload = result.payload;
  const definition = result.definition;

  // 通用 label 映射(默认指标 + 通用字段)
  const baseLabelMap: Record<string, string> = { ...REPORT_COLUMN_LABELS };
  for (const m of definition.defaultMetrics) {
    baseLabelMap[m.key] = m.label;
  }

  // 单 section 构造 helper
  const buildSection = (
    name: string,
    rows: Record<string, unknown>[],
    extraLabels: Record<string, string> = {}
  ): ExportSection | null => {
    if (rows.length === 0) return null;
    const labelMap = { ...baseLabelMap, ...extraLabels };
    const columns = Object.keys(rows[0]!).map((k) => ({
      header: labelMap[k] ?? k,
      key: k,
      width: 18,
      formatter: (v: unknown) => {
        if (v == null || v === "") return "";
        if (typeof v === "number") {
          const lowerKey = k.toLowerCase();
          if (lowerKey.includes("count") || lowerKey.includes("days")) return String(v);
          if (lowerKey.includes("rate") || lowerKey.includes("ratio")) return `${v.toFixed(2)}%`;
          return v.toFixed(2);
        }
        return String(v);
      },
    }));
    return { name, columns, rows, labelMap };
  };

  if (definition.type === "PERFORMANCE") {
    const sections: ExportSection[] = [];

    // PERFORMANCE 报表只导出 1 个 sheet: 签约明细 (按 PDF 模板)
    // 字段: 所属区域 / 企业名称 / 服务项目 / 签约人 / 合同金额（元） / 小计（万元）
    // 不再输出"员工业绩汇总" sheet — KPI 卡片 + 签约明细 已覆盖高/低聚合,
    // 避免重复冗余。
    const signerLabels: Record<string, string> = {
      region: "所属区域",
      customerName: "企业名称",
      serviceTypeLabel: "服务项目",
      signerName: "签约人",
      totalAmount: "合同金额（元）",
      subtotalWan: "小计（万元）",
    };
    const groups = (payload.signerDetail ?? []) as Array<{
      signerName: string;
      signerEmployeeNo: string;
      contractAmount: number;
      subtotalWan: number;
      rows: Array<Record<string, unknown>>;
    }>;
    if (groups.length > 0) {
      const detailRows: Array<Record<string, unknown>> = [];
      for (const g of groups) {
        // 合同行: 5 PDF 字段, 小计(万元)列空
        for (const r of g.rows) {
          detailRows.push({
            region: r.region ?? "-",
            customerName: r.customerName ?? "-",
            serviceTypeLabel: r.serviceTypeLabel ?? r.serviceType ?? "-",
            signerName: r.signerName ?? "-",
            totalAmount: r.totalAmount,
            subtotalWan: "",
          });
        }
        // 签约人小计行: 签约人位置写 "{姓名} 小计", 小计(万元)列填万元数
        // 跟 PDF 右侧万元数对齐 (PDF 是合并单元格, 这里是单行展示)
        detailRows.push({
          region: "",
          customerName: "",
          serviceTypeLabel: "",
          signerName: `${g.signerName} 小计`,
          totalAmount: g.contractAmount,
          subtotalWan: g.subtotalWan,
        });
      }
      // 全公司合计
      const total = groups.reduce((s, g) => s + g.contractAmount, 0);
      const totalWan = Math.round((total / 10_000) * 100) / 100;
      detailRows.push({
        region: "",
        customerName: "",
        serviceTypeLabel: "",
        signerName: "全公司合计",
        totalAmount: total,
        subtotalWan: totalWan,
      });

      const detailSection = buildSection("签约明细", detailRows, signerLabels);
      if (detailSection) sections.push(detailSection);
    }
    return { definition, sections };
  }

  if (definition.type === "BUSINESS") {
    const rows = (payload.region ?? []) as Record<string, unknown>[];
    const section = buildSection("区域统计明细", rows);
    return { definition, sections: section ? [section] : [] };
  }

  if (definition.type === "CUSTOM") {
    const rows = (payload.region?.length ? payload.region : payload.series ?? []) as Record<string, unknown>[];
    const section = buildSection("自定义组合报表", rows);
    return { definition, sections: section ? [section] : [] };
  }

  // FINANCIAL
  const rows = (payload.series ?? []) as Record<string, unknown>[];
  const section = buildSection("财务趋势明细", rows);
  return { definition, sections: section ? [section] : [] };
}


