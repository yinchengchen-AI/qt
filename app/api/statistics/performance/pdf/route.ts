// 业绩排行 → 打印页 HTML（用户浏览器「另存为 PDF」）
// 与页面表格 / xlsx 导出 (type=performance) 三方同口径:
//   dimension (owner/signer/region) + preset/from/to, 走 resolveStatsRange
// 结构: 排行表 (含总计行) + 业务明细 (按维度分组小计 + 总计, 超 MAX_ROWS 截断标注)
import { z } from "zod";
import { err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { resolveStatsRange } from "@/lib/date-range";
import {
  getPerformanceRanking,
  getPerformanceContractDetail
} from "@/server/services/statistics";
import { renderPrintHtml, type PrintDoc } from "@/lib/print-html";
import { exportMaxRows } from "@/lib/excel";
import { formatDate } from "@/lib/format";

const query = z.object({
  dimension: z.enum(["owner", "signer", "region"]).default("owner"),
  preset: z.enum(["month", "quarter", "year"]).optional(),
  from: z.string().optional(),
  to: z.string().optional()
});

const DIMENSION_LABEL = { owner: "按员工", signer: "按签约人", region: "按区域" } as const;

const fmtDate = (s: string | Date | null | undefined) => (s ? formatDate(s) : "-");

// 金额统一保留 2 位小数,与 Excel #,##0.00 对齐
const fmtMoney = (v: string | number | null | undefined) => {
  if (v == null || v === "") return "-";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "-";
};

const fmtRate = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "0.00");

type TableRow = Record<string, string | number>;

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.EXPORT);
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const range = resolveStatsRange(parsed);
      const dimension = parsed.dimension;
      const isRegion = dimension === "region";
      const maxRows = exportMaxRows();

      const [ranking, detail] = await Promise.all([
        getPerformanceRanking(user, dimension, range, maxRows),
        getPerformanceContractDetail(user, dimension, range)
      ]);

      const dimensionLabel = DIMENSION_LABEL[dimension];
      const entityUnit = isRegion ? "个区域" : "人";
      const groupUnit = isRegion ? "个区域" : "名员工";

      const totals = ranking.reduce(
        (acc, r) => {
          acc.contractCount += r.contractCount;
          acc.contractAmount += r.contractAmount;
          acc.invoiceAmount += r.invoiceAmount;
          acc.paymentAmount += r.paymentAmount;
          acc.unpaidAmount += r.unpaidAmount;
          acc.customerCount += r.customerCount ?? 0;
          return acc;
        },
        { contractCount: 0, contractAmount: 0, invoiceAmount: 0, paymentAmount: 0, unpaidAmount: 0, customerCount: 0 }
      );
      const totalInvRate = totals.contractAmount > 0 ? (totals.invoiceAmount / totals.contractAmount) * 100 : 0;
      const totalPayRate = totals.invoiceAmount > 0 ? (totals.paymentAmount / totals.invoiceAmount) * 100 : 0;

      const periodLabel = `${fmtDate(range.from)} ~ ${fmtDate(range.to)}`;

      // ==== 表 1: 业绩排行 ====
      const secondCol = isRegion ? "区域" : "姓名";
      const thirdCol = isRegion ? "客户数" : "工号";
      const rankingColumns = [
        "名次", secondCol, thirdCol, "合同数", "合同额",
        "已开票额", "已回款额", "未回款额", "开票率(%)", "回款率(%)"
      ];
      const rankingRows: TableRow[] = ranking.map((r) => ({
        名次: r.rank,
        [secondCol]: r.name,
        [thirdCol]: isRegion ? (r.customerCount ?? 0) : (r.employeeNo ?? ""),
        合同数: r.contractCount,
        合同额: fmtMoney(r.contractAmount),
        已开票额: fmtMoney(r.invoiceAmount),
        已回款额: fmtMoney(r.paymentAmount),
        未回款额: fmtMoney(r.unpaidAmount),
        "开票率(%)": fmtRate(r.invoiceRate),
        "回款率(%)": fmtRate(r.paymentRate),
        __kind: "data" as const
      }));
      rankingRows.push({
        名次: "",
        [secondCol]: `总计 (${ranking.length} ${entityUnit})`,
        [thirdCol]: isRegion ? totals.customerCount : "",
        合同数: totals.contractCount,
        合同额: fmtMoney(totals.contractAmount),
        已开票额: fmtMoney(totals.invoiceAmount),
        已回款额: fmtMoney(totals.paymentAmount),
        未回款额: fmtMoney(totals.unpaidAmount),
        "开票率(%)": fmtRate(totalInvRate),
        "回款率(%)": fmtRate(totalPayRate),
        __kind: "total" as const
      });

      // ==== 表 2: 业务明细 (与 xlsx Sheet 2 同款截断逻辑) ====
      const totalContracts = detail.reduce((s, g) => s + g.rows.length, 0);
      const truncated = totalContracts > maxRows;
      let remaining = maxRows;
      const shownGroups = detail
        .map((g) => {
          const rows = g.rows.slice(0, Math.max(remaining, 0));
          remaining -= rows.length;
          return { ...g, rows };
        })
        .filter((g) => g.rows.length > 0);

      const detailColumns = ["所属区域", "企业名称", "服务项目", "负责人", "签约人", "合同号", "签约日期", "合同金额"];
      const detailRows: TableRow[] = [];
      let shownCount = 0;
      let shownAmount = 0;
      for (const g of shownGroups) {
        let gAmount = 0;
        for (const r of g.rows) {
          detailRows.push({
            所属区域: r.region,
            企业名称: r.customerName,
            服务项目: r.serviceTypeLabel,
            负责人: r.ownerName,
            签约人: r.signerName,
            合同号: r.contractNo,
            签约日期: fmtDate(r.signDate),
            合同金额: fmtMoney(r.totalAmount),
            __kind: "data" as const
          });
          gAmount += r.totalAmount;
          shownCount += 1;
          shownAmount += r.totalAmount;
        }
        detailRows.push({
          所属区域: "",
          企业名称: `小计: ${g.label}`,
          服务项目: `${g.rows.length} 份合同`,
          负责人: "",
          签约人: "",
          合同号: "",
          签约日期: "",
          合同金额: fmtMoney(Number(gAmount.toFixed(2))),
          __kind: "subtotal" as const
        });
      }
      detailRows.push({
        所属区域: "",
        企业名称: truncated
          ? `总计 (显示 ${shownCount} / 共 ${totalContracts} 份合同)`
          : `总计 (${shownCount} 份合同)`,
        服务项目: `${shownGroups.length} ${groupUnit}`,
        负责人: "",
        签约人: "",
        合同号: "",
        签约日期: "",
        合同金额: fmtMoney(Number(shownAmount.toFixed(2))),
        __kind: "total" as const
      });

      const doc: PrintDoc = {
        title: "业绩排行报表",
        subtitle: `${dimensionLabel} · 共 ${ranking.length} ${entityUnit}`,
        periodLabel,
        orientation: "landscape",
        mainRows: [
          { label: "统计周期", value: periodLabel },
          { label: "统计维度", value: dimensionLabel },
          { label: "上榜条目", value: `${ranking.length} ${entityUnit}` },
          { label: "合同份数", value: `${totals.contractCount} 份` }
        ],
        summary: [
          { label: "合同总额", value: fmtMoney(totals.contractAmount), tone: "primary" },
          { label: "已开票额", value: fmtMoney(totals.invoiceAmount), tone: "warning" },
          { label: "已回款额", value: fmtMoney(totals.paymentAmount), tone: "success" },
          { label: "未回款额", value: fmtMoney(totals.unpaidAmount), tone: "danger" }
        ],
        sections: [
          {
            title: "业绩排行",
            columns: rankingColumns,
            rows: rankingRows,
            rowClass: (row) => (row["__kind"] === "total" ? "total" : undefined),
            cellClass: (column) =>
              ["合同额", "已开票额", "已回款额", "未回款额", "开票率(%)", "回款率(%)"].includes(column)
                ? "amount"
                : undefined
          },
          {
            title: `业务明细 (${dimensionLabel}分组)`,
            columns: detailColumns,
            rows: detailRows,
            rowClass: (row) => {
              const kind = row["__kind"];
              if (kind === "total") return "total";
              if (kind === "subtotal") return "subtotal";
              return undefined;
            },
            cellClass: (column) =>
              column === "合同金额" || column === "签约日期" ? "amount" : undefined
          }
        ],
        note: `口径说明: 排行与明细均按「${dimensionLabel}」维度同口径取数, 各组小计之和 = 总计, 与业绩排行页面及 xlsx 导出一致。`,
        signature: true
      };
      return new Response(renderPrintHtml(doc), {
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    } catch (e) {
      return err(e);
    }
  });
}
