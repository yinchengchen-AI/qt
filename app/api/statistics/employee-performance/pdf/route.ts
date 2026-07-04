// 员工业绩汇总 → 打印页 HTML（用户浏览器「另存为 PDF」）
// 模板与 2026年5月业务明细.pdf 1:1 对齐:
//   - 6 列: 所属区域 | 企业名称 | 服务项目 | 签约人 | 合同金额 | (小计)
//   - 同一签约人连续多行, 小计值写在「最后一笔合同行」第 6 列 (与原 PDF 视觉一致)
//   - 末行无「全公司合计」加粗行, 全公司合计写在 note 区
//   - 合同金额: 整数元 (原 PDF 无 .00 无 ¥); 小计/合计: 2 位小数万元
//   - 跨页: 续表无表头 (与原 PDF 第 2 页结构一致)
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
      const [ownerRows, summary, detail] = await Promise.all([
        getEmployeePerformance(user, undefined, range),
        getSignerSummary(user, range),
        getSignerContractDetail(user, range)
      ]);

      // 全公司合计 (owner 维度): 与页面 KPI、xlsx 导出口径一致
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

      // signer 维度自己的合计 (用于 note 注解: 维度差异)
      const signerTotal = summary.reduce(
        (acc, r) => {
          acc.contractCount += r.contractCount;
          acc.contractAmount += r.contractAmount;
          return acc;
        },
        { contractCount: 0, contractAmount: 0 }
      );
      const signerTotalWan = signerTotal.contractAmount / 10_000;

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
          { label: "合同总额", value: fmtAmountInt(totals.contractAmount), tone: "primary" },
          { label: "已开票额", value: fmtAmountInt(totals.invoiceAmount), tone: "warning" },
          { label: "已回款额", value: fmtAmountInt(totals.paymentAmount), tone: "success" },
          { label: "未回款额", value: fmtAmountInt(remainingPayment), tone: "danger" }
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
        // 全公司合计放在 note 区域, 模拟原 PDF 末行 34.88 风格
        note: `全公司合计：${fmtWan(totalWan)} 万元
(按业务负责人 ownerUserId 维度, 共 ${totals.contractCount} 份合同)
签约人维度合计: ${fmtWan(signerTotalWan)} 万元 (与「全公司合计」差额为维度差异: 同一份合同 owner 与 signer 不同时, 仅计入 owner 维度)`,
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
