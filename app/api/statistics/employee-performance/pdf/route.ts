
// 员工业绩汇总 → 打印页 HTML（用户浏览器「另存为 PDF」）
// 结构对标 Excel 导出：汇总表（8 列）+ 明细表（7 列，按签约人分组小计）
import { z } from "zod";
import { err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { resolveDateRangeQuery } from "@/lib/date-range";
import {
  getSignerSummary,
  getSignerContractDetail
} from "@/server/services/statistics";
import { renderPrintHtml, type PrintDoc } from "@/lib/print-html";
import { formatDate } from "@/lib/format";

const query = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.string().optional()
});

const fmtDate = (s: string | Date | null | undefined) =>
  s ? formatDate(s) : "-";

// 金额统一保留 2 位小数，与 Excel #,##0.00 对齐
const fmtMoney = (v: string | number | null | undefined) => {
  if (v == null || v === "") return "-";
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "-";
};

// 百分比保留 1 位小数
const fmtRate = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "0.0");

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.EXPORT);
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const range = resolveDateRangeQuery(parsed);

      const [summary, detail] = await Promise.all([
        getSignerSummary(user, range),
        getSignerContractDetail(user, range)
      ]);

      const signerTotal = summary.reduce(
        (acc, r) => {
          acc.contractCount += r.contractCount;
          acc.contractAmount += r.contractAmount;
          acc.invoiceAmount += r.invoiceAmount;
          acc.paymentAmount += r.paymentAmount;
          return acc;
        },
        { contractCount: 0, contractAmount: 0, invoiceAmount: 0, paymentAmount: 0 }
      );

      const periodLabel = `${fmtDate(range.from)} ~ ${fmtDate(range.to)}`;

      type SummaryRow = Record<string, string | number>;
      const summaryColumns = [
        "姓名",
        "合同数",
        "合同额",
        "已开票额",
        "已回款额",
        "未回款额",
        "开票率(%)",
        "回款率(%)"
      ];
      const summaryRows: SummaryRow[] = summary.map((r) => {
        const unpaid = Math.max(r.contractAmount - r.paymentAmount, 0);
        const invRate = r.contractAmount > 0 ? (r.invoiceAmount / r.contractAmount) * 100 : 0;
        const payRate = r.invoiceAmount > 0 ? (r.paymentAmount / r.invoiceAmount) * 100 : 0;
        return {
          姓名: r.name,
          合同数: r.contractCount,
          合同额: fmtMoney(r.contractAmount),
          已开票额: fmtMoney(r.invoiceAmount),
          已回款额: fmtMoney(r.paymentAmount),
          未回款额: fmtMoney(unpaid),
          "开票率(%)": fmtRate(invRate),
          "回款率(%)": fmtRate(payRate)
        };
      });
      // 总计行
      const totalUnpaid = Math.max(signerTotal.contractAmount - signerTotal.paymentAmount, 0);
      const totalInvRate = signerTotal.contractAmount > 0
        ? (signerTotal.invoiceAmount / signerTotal.contractAmount) * 100
        : 0;
      const totalPayRate = signerTotal.invoiceAmount > 0
        ? (signerTotal.paymentAmount / signerTotal.invoiceAmount) * 100
        : 0;
      summaryRows.push({
        姓名: `总计 (${summary.length} 人)`,
        合同数: signerTotal.contractCount,
        合同额: fmtMoney(signerTotal.contractAmount),
        已开票额: fmtMoney(signerTotal.invoiceAmount),
        已回款额: fmtMoney(signerTotal.paymentAmount),
        未回款额: fmtMoney(totalUnpaid),
        "开票率(%)": fmtRate(totalInvRate),
        "回款率(%)": fmtRate(totalPayRate)
      });

      type DetailRow = Record<string, string | number>;
      const detailColumns = [
        "所属区域",
        "企业名称",
        "服务项目",
        "签约人",
        "合同号",
        "签约日期",
        "合同金额"
      ];
      const detailRows: DetailRow[] = [];
      for (const g of detail) {
        for (const r of g.rows) {
          detailRows.push({
            所属区域: r.region,
            企业名称: r.customerName,
            服务项目: r.serviceTypeLabel,
            签约人: g.signerName,
            合同号: r.contractNo,
            签约日期: fmtDate(r.signDate),
            合同金额: fmtMoney(r.totalAmount),
            __kind: "data" as const
          });
        }
        // 小计行
        detailRows.push({
          所属区域: "",
          企业名称: `小计: ${g.signerName}`,
          服务项目: `${g.rows.length} 份合同`,
          签约人: "",
          合同号: "",
          签约日期: "",
          合同金额: fmtMoney(g.contractAmount),
          __kind: "subtotal" as const
        });
      }
      // 总计行
      detailRows.push({
        所属区域: "",
        企业名称: `总计: 全公司 (${signerTotal.contractCount} 份合同)`,
        服务项目: `${detail.length} 名签约人`,
        签约人: "",
        合同号: "",
        签约日期: "",
        合同金额: fmtMoney(signerTotal.contractAmount),
        __kind: "total" as const
      });

      const signerRemaining = Math.max(signerTotal.contractAmount - signerTotal.paymentAmount, 0);

      const doc: PrintDoc = {
        title: "员工业绩汇总报表",
        subtitle: `按签约人分组 · 共 ${summary.length} 人`,
        periodLabel,
        orientation: "landscape",
        mainRows: [
          { label: "统计周期", value: periodLabel },
          { label: "签约人数", value: `${summary.length} 人` },
          { label: "合同份数", value: `${signerTotal.contractCount} 份` }
        ],
        summary: [
          { label: "合同总额", value: fmtMoney(signerTotal.contractAmount), tone: "primary" },
          { label: "已开票额", value: fmtMoney(signerTotal.invoiceAmount), tone: "warning" },
          { label: "已回款额", value: fmtMoney(signerTotal.paymentAmount), tone: "success" },
          { label: "未回款额", value: fmtMoney(signerRemaining), tone: "danger" }
        ],
        sections: [
          {
            title: "员工业绩汇总",
            columns: summaryColumns,
            rows: summaryRows,
            rowClass: (row) => {
              if (String(row["姓名"]).startsWith("总计")) return "total";
              return undefined;
            },
            cellClass: (column) => {
              if (column === "合同额" || column === "已开票额" || column === "已回款额" || column === "未回款额" || column === "开票率(%)" || column === "回款率(%)") return "amount";
              return undefined;
            }
          },
          {
            title: "签约明细 (按签约人分组)",
            columns: detailColumns,
            rows: detailRows,
            rowClass: (row) => {
              const kind = row["__kind"];
              if (kind === "total") return "total";
              if (kind === "subtotal") return "subtotal";
              return undefined;
            },
            cellClass: (column) => {
              if (column === "合同金额" || column === "签约日期") return "amount";
              return undefined;
            }
          }
        ],
        note: `口径说明: 明细表按签约人 (signerId) 维度分组，各小计（元）与末行「全公司合计」同口径，数学自洽 (Σ 各签约人小计 = 全公司合计)。`,
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
