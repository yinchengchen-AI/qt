import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { parseDateRangeQuery, exportFileTimestamp } from "@/lib/date-range";
import {
  findSnapshot,
  assertExportPermission,
  type ReportPayload,
  type ReportMetric,
} from "@/server/services/report";
import { renderPrintHtml, type PrintDoc, type PrintSummaryItem, type PrintTableSection } from "@/lib/print-html";
import { formatCurrency } from "@/lib/format";
import { reportColumnLabel } from "@/lib/report-labels";

// 员工业绩明细 PDF 专用:
// 合同金额 走纯数字格式 (与原 PDF 一致: "5000" / "7500" / "20000", 不带 ¥/千分位/小数)
// serviceTypeLabel 已是中文 label, 原样展示
function renderSignerAmount(v: unknown): string {
  if (typeof v !== "number") return String(v ?? "-");
  // 原 PDF 用整数, 不带小数点. 万元小数 (subtotalWan) 单独走
  return String(Math.round(v));
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

  // 员工业绩报表: 详情只有 1 段 — 签约明细 (按 PDF 5 字段 + 万元小计)
  // KPI 卡片由 buildPrintDoc 的 summary 承载, 不重复员工业绩汇总表 (与 PDF 不符)
  // 签约明细 (PDF 5 字段 + 小计万元列) — 与 PDF 模板一一对应
  if (payload.signerDetail && (payload.signerDetail as unknown[]).length > 0) {
    const groups = payload.signerDetail as Array<{
      signerName: string;
      rows: Array<Record<string, string | number | null | undefined>>;
      contractAmount: number;
      subtotalWan: number;
    }>;
    // 列顺序: 5 PDF 字段 + 末列小计(万元)
    const signerColumns = ["所属区域", "企业名称", "服务项目", "签约人", "合同金额（元）", "小计（万元）"];
    const flat: Array<Record<string, string | number | null | undefined>> = [];
    for (const g of groups) {
      for (const r of g.rows) {
        flat.push({
          rowType: "detail",
          所属区域: r.region ?? "-",
          企业名称: r.customerName ?? "-",
          服务项目: r.serviceTypeLabel ?? r.serviceType ?? "-",
          签约人: r.signerName ?? "-",
          "合同金额（元）": renderSignerAmount(r.totalAmount),
          "小计（万元）": "",
        });
      }
      // 签约人小计行: 签约人位置写 "{姓名} 小计", 末列写万元合计
      flat.push({
        rowType: "subtotal",
        所属区域: "",
        企业名称: "",
        服务项目: "",
        签约人: `${g.signerName} 小计`,
        "合同金额（元）": renderSignerAmount(g.contractAmount),
        "小计（万元）": typeof g.subtotalWan === "number" ? g.subtotalWan.toFixed(2) : String(g.subtotalWan ?? ""),
      });
    }
    // 全公司合计
    const grandTotal = groups.reduce((s, g) => s + Number(g.contractAmount ?? 0), 0);
    const grandWan = Math.round((grandTotal / 10_000) * 100) / 100;
    flat.push({
      rowType: "total",
      所属区域: "",
      企业名称: "",
      服务项目: "",
      签约人: "全公司合计",
      "合同金额（元）": renderSignerAmount(grandTotal),
      "小计（万元）": grandWan.toFixed(2),
    });
    if (flat.length > 0) {
      // 通过 row["rowType"] 区分 合同行 / 签约人小计 / 全公司合计, 给 tr 加 class 高亮
      // 通过 cellClass 给 合同金额/小计(万元) 列加 right-align + 等宽数字 class
      // 注: 这里的 rowType 字段不渲染在 table 里 (table 用的是 columns + r[c] 取值),
      // 但我们仍然可以读它来做样式
      const tagged = flat.map((r) => ({ ...r, _rowType: (r as { rowType?: string }).rowType ?? "detail" }));
      sections.push({
        title: "员工业绩明细（按签约人）",
        columns: signerColumns,
        rows: tagged as Array<Record<string, string | number | null | undefined>>,
        emptyText: "当前周期暂无签约明细",
        tableClass: "signer-detail",
        rowClass: (r) => {
          const t = (r as { _rowType?: string })._rowType;
          if (t === "total") return "signer-total";
          if (t === "subtotal") return "signer-subtotal";
          return "detail-row";
        },
        cellClass: (col, _v) => {
          if (col === "合同金额（元）") return "amount";
          if (col === "小计（万元）") return "subtotal-wan";
          return undefined;
        },
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

      const result = await findSnapshot(
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

      // 文件名: definition.name + periodLabel + ts (YYYY-MM-DD_HHMM)
      // 加 Content-Disposition: 用 inline (让浏览器内嵌显示, 不强制下载),
      // 但带 filename= 建议, 用户在浏览器"另存为 PDF"时默认用这个文件名
      const ts = exportFileTimestamp();
      const pdfName = `${result.definition.name}_${result.periodLabel}_${ts}.html`;
      return new Response(html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `inline; filename="${encodeURIComponent(pdfName)}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return err(e);
    }
  });
}
