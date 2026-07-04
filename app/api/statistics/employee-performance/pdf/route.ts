// 员工业绩汇总 → 打印页 HTML（用户浏览器「另存为 PDF」）
// 模板与 2026年5月业务明细.pdf 1:1 对齐:
//   - 6 列: 所属区域 | 企业名称 | 服务项目 | 签约人 | 合同金额 | (小计)
//   - 同一签约人连续多行, 小计值写在「最后一笔合同行」第 6 列 (与原 PDF 视觉一致)
//   - 末行追加「全公司合计」加粗行, 金额列填合计 (元) + 第 6 列填合计 (万元)
//   - 合同金额: 整数元 (原 PDF 无 .00 无 ¥); 小计/合计: 2 位小数万元
//   - 跨页: 续表无表头 (与原 PDF 第 2 页结构一致)
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

const query = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.string().optional()
});

const fmtDate = (s: string | Date | null | undefined) =>
  s ? new Date(s).toLocaleDateString("zh-CN") : "-";
// 合同金额: 整数元 (原 PDF 风格, 不带 ¥ 不带 .00)
const fmtAmountInt = (v: string | number | null | undefined) => {
  if (v == null || v === "") return "-";
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? String(n) : "-";
};
// 万元: 2 位小数
const fmtWan = (v: number) => (v / 10_000).toFixed(2);

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.EXPORT);
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const range = resolveDateRangeQuery(parsed);

      // 三路并行: 顶部 KPI 用 owner 维度 (与页面 KPI / xlsx 一致),
      // 明细表用 signer 维度 (PDF 模板要求按签约人分组)。
      const [summary, detail] = await Promise.all([
        getSignerSummary(user, range),
        getSignerContractDetail(user, range)
      ]);

      // 全公司合计 (按签约人 signerId 维度, 与明细表小计同口径, 数学自洽)
      // 顶部 KPI 卡片、mainRows、note 合计均统一用此值。
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

      // 构造明细表 (6 列, 1:1 还原原 PDF):
      // - 同一签约人多笔合同时, 小计值仅写在最后一笔合同行第 6 列
      // - 其它行第 6 列留空
      type DetailRow = Record<string, string | number>;
      const detailColumns = ["所属区域", "企业名称", "服务项目", "签约人", "合同金额", ""];
      const detailRows: DetailRow[] = [];
      for (const g of detail) {
        for (let i = 0; i < g.rows.length; i++) {
          const r = g.rows[i]!;
          const isLast = i === g.rows.length - 1;
          detailRows.push({
            "所属区域": r.region,
            "企业名称": r.customerName,
            "服务项目": r.serviceTypeLabel,
            "签约人": `${g.signerName}（${g.signerEmployeeNo}）`,
            "合同金额": fmtAmountInt(r.totalAmount),
            // 第 6 列: 仅末笔合同行写小计
            "": isLast ? fmtWan(g.subtotalWan) : ""
          });
        }
      }
      // 末行: 全公司合计 (深灰底加粗, 与原 PDF 末行 34.88 风格一致)
      detailRows.push({
        "所属区域": "",
        "企业名称": `全公司合计 (${signerTotal.contractCount} 份合同)`,
        "服务项目": `${summary.length} 名签约人`,
        "签约人": "",
        "合同金额": signerTotal.contractAmount,
        "": fmtWan(signerTotal.contractAmount / 10_000)
      });

      const signerRemaining = Math.max(signerTotal.contractAmount - signerTotal.paymentAmount, 0);

      const doc: PrintDoc = {
        title: "员工业绩汇总报表",
        subtitle: `按签约人分组 · 共 ${summary.length} 人`,
        periodLabel,
        mainRows: [
          { label: "统计周期", value: periodLabel },
          { label: "签约人数", value: `${summary.length} 人` },
          { label: "合同份数", value: `${signerTotal.contractCount} 份` }
        ],
        summary: [
          { label: "合同总额", value: fmtAmountInt(signerTotal.contractAmount), tone: "primary" },
          { label: "已开票额", value: fmtAmountInt(signerTotal.invoiceAmount), tone: "warning" },
          { label: "已回款额", value: fmtAmountInt(signerTotal.paymentAmount), tone: "success" },
          { label: "未回款额", value: fmtAmountInt(signerRemaining), tone: "danger" }
        ],
        sections: detail.length
          ? [
              {
                title: "签约明细 (按签约人分组)",
                columns: detailColumns,
                tableClass: "signer-detail",
                cellClass: (column) => {
                  if (column === "合同金额" || column === "") return "amount";
                  return undefined;
                },
                rows: detailRows
              }
            ]
          : [],
        // 合计已嵌入明细表末行, 此处只做维度说明
        note: `口径说明: 明细表按签约人 (signerId) 维度分组, 各小计 (万元) 与末行「全公司合计」同口径, 数学自洽 (Σ 各签约人小计 = 全公司合计)。`,
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
