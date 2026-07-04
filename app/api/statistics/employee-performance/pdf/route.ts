// 员工业绩汇总 → 打印页 HTML（用户浏览器「另存为 PDF」）
// 模板与 2026年5月业务明细.pdf 对齐：按签约人分组、组内明细、组末小计（万元）、全公司合计。
// 口径说明：
//   - 全公司合计 / 顶部 KPI 卡片：按「业务负责人 (ownerUserId)」聚合，与员工业绩页面 KPI 卡、xlsx 导出口径一致。
//   - 签约明细表：按「签约人 (signerId)」分组（小计列），这是 PDF 模板本来的视觉结构。
//   - 两者维度不同时（如 owner=A, signer=B 的合同），全公司合计与「Σ 各签约人小计」会有出入，属于维度差异，非计算错误。
import { z } from "zod";
import { err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { resolveDateRangeQuery } from "@/lib/date-range";
import {
  getEmployeePerformance,
  getSignerSummary,
  getSignerContractDetail
} from "@/server/services/statistics";
import { renderPrintHtml, type PrintDoc } from "@/lib/print-html";

const query = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.string().optional()
});

const fmtDate = (s: string | Date | null | undefined) =>
  s ? new Date(s).toLocaleDateString("zh-CN") : "-";
const fmtAmount = (v: string | number | null | undefined) =>
  v == null || v === "" ? "-" : Number(v).toFixed(2);
const fmtWan = (v: number) => (v / 10_000).toFixed(2);

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.EXPORT);
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const range = resolveDateRangeQuery(parsed);

      // 三路并行: 顶部 KPI/合计用 owner 维度 (与页面 KPI / xlsx 一致),
      // 明细表用 signer 维度 (PDF 模板要求按签约人分组)。
      const [ownerRows, summary, detail] = await Promise.all([
        getEmployeePerformance(user, undefined, range),
        getSignerSummary(user, range),
        getSignerContractDetail(user, range)
      ]);

      // 全公司合计 (owner 维度): 与页面 KPI 卡片、xlsx 导出口径完全一致
      const totals = ownerRows.reduce(
        (acc, r) => {
          acc.contractCount += r.contractCount;
          acc.contractAmount += r.contractAmount;
          acc.invoiceAmount += r.invoiceAmount;
          acc.paymentAmount += r.paymentAmount;
          return acc;
        },
        { contractCount: 0, contractAmount: 0, invoiceAmount: 0, paymentAmount: 0 }
      );
      const totalWan = totals.contractAmount / 10_000;

      const periodLabel = `${fmtDate(range.from)} ~ ${fmtDate(range.to)}`;

      // 构造明细表：参照 2026年5月业务明细.pdf
      // - 明细行金额: 裸数字 (原 PDF 风格, 不带 ¥)
      // - 每个签约人最后一笔合同同行右侧追加万元小计
      // - 全公司末行: 全公司合计 (N 份合同, X.XX 万元) — owner 维度
      type DetailRow = Record<string, string | number>;
      const detailColumns = ["所属区域", "企业名称", "服务项目", "签约人", "合同金额"];
      const detailRows: DetailRow[] = [];
      for (const g of detail) {
        const lastIdx = g.rows.length - 1;
        for (const r of g.rows) {
          const isLast = r === g.rows[lastIdx];
          detailRows.push({
            "所属区域": r.region,
            "企业名称": r.customerName,
            "服务项目": r.serviceTypeLabel,
            "签约人": `${g.signerName}（${g.signerEmployeeNo}）`,
            "合同金额": isLast
              ? `${fmtAmount(r.totalAmount)} / 小计 ${fmtWan(g.subtotalWan)} 万元`
              : fmtAmount(r.totalAmount)
          });
        }
      }
      detailRows.push({
        "所属区域": "",
        "企业名称": `全公司合计 (${totals.contractCount} 份合同)`,
        "服务项目": "",
        "签约人": "",
        "合同金额": `${fmtWan(totalWan)} 万元`
      });

      const remainingPayment = Math.max(totals.contractAmount - totals.paymentAmount, 0);

      const doc: PrintDoc = {
        title: "员工业绩汇总",
        subtitle: `按签约人分组 · 共 ${summary.length} 人`,
        periodLabel,
        mainRows: [
          { label: "统计周期", value: periodLabel },
          { label: "员工人数", value: `${ownerRows.length} 人` },
          { label: "合同份数", value: `${totals.contractCount} 份` }
        ],
        summary: [
          { label: "合同总额", value: fmtAmount(totals.contractAmount), tone: "primary" },
          { label: "已开票额", value: fmtAmount(totals.invoiceAmount), tone: "warning" },
          { label: "已回款额", value: fmtAmount(totals.paymentAmount), tone: "success" },
          { label: "未回款额", value: fmtAmount(remainingPayment), tone: "danger" }
        ],
        sections: detail.length
          ? [
              {
                title: "签约明细 (按签约人分组)",
                columns: detailColumns,
                tableClass: "signer-detail",
                cellClass: (column) => {
                  if (column === "合同金额") return "amount";
                  return undefined;
                },
                rowClass: (row) => {
                  const name = String(row["企业名称"] ?? "");
                  if (name.startsWith("全公司合计")) return "signer-total";
                  if (name.startsWith("小计")) return "signer-subtotal";
                  return "detail-row";
                },
                rows: detailRows
              }
            ]
          : [],
        note: "本表顶部 KPI 卡片与「全公司合计」按业务负责人 (ownerUserId) 维度聚合, 与员工业绩页面 KPI 卡片、xlsx 导出口径完全一致; 明细表按签约人 (signerId) 分组 (原 PDF 模板要求), 同一份合同 owner 与 signer 不同时, 「Σ 各签约人小计」与全公司合计会有差额 (维度差异, 非计算错误)。",
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
