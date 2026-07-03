import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { parseDateRangeQuery } from "@/lib/date-range";
import {
  getOrBuildSnapshot,
  assertExportPermission,
  type ReportPayload,
  type ReportMetric,
} from "@/server/services/report";
import { renderPrintHtml, type PrintDoc, type PrintSummaryItem, type PrintTableSection } from "@/lib/print-html";
import { formatCurrency } from "@/lib/format";
import { reportColumnLabel } from "@/lib/report-labels";

// 合同金额在 PDF 表格里需要带千分位;serviceTypeLabel 已是中文 label,原样展示
function renderSignerAmount(v: unknown): string {
  if (typeof v !== "number") return String(v ?? "-");
  return formatCurrency(v);
}

const query = z.object({
  periodType: z.enum(["MONTH", "QUARTER", "YEAR", "CUSTOM"]),
  from: z.string().optional(),
  to: z.string().optional(),
});

function formatValue(key: string, value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "number") {
    if (key.toLowerCase().includes("rate") || key.toLowerCase().includes("ratio")) {
      return `${value.toFixed(2)}%`;
    }
    if (key.toLowerCase().includes("count")) {
      return String(value);
    }
    return formatCurrency(value);
  }
  return String(value);
}

function buildPrintDoc(
  title: string,
  periodLabel: string,
  metrics: ReportMetric[],
  payload: ReportPayload
): PrintDoc {
  const summary: PrintSummaryItem[] = [];
  if (payload.overview) {
    for (const m of metrics) {
      const raw = payload.overview[m.key];
      summary.push({ label: m.label, value: formatValue(m.key, raw) });
    }
  }

  const sections: PrintTableSection[] = [];

  if (payload.performance && payload.performance.length > 0) {
    const perf = payload.performance as Record<string, string | number | null | undefined>[];
    sections.push({
      title: "员工业绩汇总",
      columns: Object.keys(perf[0]!).map(reportColumnLabel),
      rows: perf,
    });
  }

  // 签约明细(按签约人分组的合同级明细,字段对齐 2026年5月业务明细.pdf)
  if (payload.signerDetail && (payload.signerDetail as unknown[]).length > 0) {
    const groups = payload.signerDetail as Array<{
      signerName: string;
      signerEmployeeNo: string;
      rows: Array<Record<string, string | number | null | undefined>>;
      contractAmount: number;
      subtotalWan: number;
    }>;
    const signerColumns = ["所属区域", "企业名称", "服务项目", "签约人", "合同金额（元）"];
    const flat: Array<Record<string, string | number | null | undefined>> = [];
    for (const g of groups) {
      for (const r of g.rows) {
        flat.push({
          所属区域: r.region ?? "-",
          企业名称: r.customerName ?? "-",
          服务项目: r.serviceTypeLabel ?? r.serviceType ?? "-",
          签约人: r.signerName ?? "-",
          合同金额: renderSignerAmount(r.totalAmount),
        });
      }
      flat.push({
        所属区域: "",
        企业名称: "",
        服务项目: `${g.signerName}（${g.signerEmployeeNo}）小计`,
        签约人: "",
        合同金额: renderSignerAmount(g.contractAmount),
      });
    }
    if (flat.length > 0) {
      sections.push({
        title: "签约明细（按签约人）",
        columns: signerColumns,
        rows: flat,
        emptyText: "当前周期暂无签约明细",
      });
    }
  }

  if (payload.region && payload.region.length > 0) {
    const region = payload.region as Record<string, string | number | null | undefined>[];
    sections.push({
      title: "区域统计明细",
      columns: Object.keys(region[0]!).map(reportColumnLabel),
      rows: region,
    });
  }

  if (payload.series && payload.series.length > 0) {
    const series = payload.series as Record<string, string | number | null | undefined>[];
    sections.push({
      title: "趋势明细",
      columns: Object.keys(series[0]!).map(reportColumnLabel),
      rows: series,
    });
  }

  return {
    title,
    subtitle: `统计周期：${periodLabel}`,
    meta: [{ label: "报表类型", value: title }],
    mainRows: [{ label: "统计周期", value: periodLabel }],
    summary,
    sections,
    note: "本报表由系统自动生成，数据以快照生成时点为准。",
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      assertExportPermission(user);
      const { code } = await params;
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const range = parseDateRangeQuery({ from: parsed.from, to: parsed.to });

      const result = await getOrBuildSnapshot(
        user,
        code,
        parsed.periodType,
        parsed.periodType === "CUSTOM" ? range : undefined
      );

      const doc = buildPrintDoc(
        result.definition.name,
        result.periodLabel,
        result.definition.defaultMetrics,
        result.payload
      );
      const html = renderPrintHtml(doc);

      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return err(e);
    }
  });
}
