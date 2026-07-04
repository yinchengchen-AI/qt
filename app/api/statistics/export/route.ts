import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { err, ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import {
  getTopCustomers,
  getOverview,
  getRegionStatistics,
  getInvoiceAging,
  getSignerSummary,
  getSignerContractDetail
} from "@/server/services/statistics";
import ExcelJS from "exceljs";
import { exportToXlsx, exportMaxRows, attachmentHeader } from "@/lib/excel";
import { parseDateRangeQuery, exportFileTimestamp} from "@/lib/date-range";

// 员工业绩 xlsx 导出: 2 sheet, 含分组小计 + 总计
//   Sheet 1 「员工业绩汇总」: 一员工一行, 末行总计
//   Sheet 2 「签约明细」: 按签约人分组, 组末小计 + 末行总计
// 样式: 表头加粗; 总计行深灰底加粗; 小计行浅灰底加粗
async function buildEmployeePerformanceXlsx(
  summary: Array<{ userId: string; name: string; employeeNo: string; contractCount: number; contractAmount: number; invoiceAmount: number; paymentAmount: number }>,
  detail: Array<{ signerId: string; signerName: string; signerEmployeeNo: string; rows: Array<{ contractId: string; contractNo: string; region: string; customerName: string; serviceTypeLabel: string; signDate: string | Date; totalAmount: number }>; contractAmount: number; subtotalWan: number }>
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  // 浅灰底 (#E5E7EB) + 加粗 = 小计
  // 深灰底 (#D1D5DB) + 加粗 = 总计
  const FILL_SUBTOTAL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
  const FILL_TOTAL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1D5DB" } };

  // ==== Sheet 1: 员工业绩汇总 ====
  const ws1 = wb.addWorksheet("员工业绩汇总");
  ws1.columns = [
    { header: "工号", key: "employeeNo", width: 12 },
    { header: "姓名", key: "name", width: 14 },
    { header: "合同数", key: "contractCount", width: 10 },
    { header: "合同额", key: "contractAmount", width: 18 },
    { header: "已开票额", key: "invoiceAmount", width: 18 },
    { header: "已回款额", key: "paymentAmount", width: 18 },
    { header: "未回款额", key: "unpaidAmount", width: 18 },
    { header: "开票率(%)", key: "invoiceRate", width: 12 },
    { header: "回款率(%)", key: "paymentRate", width: 12 }
  ];
  ws1.getRow(1).font = { bold: true };
  ws1.getRow(1).alignment = { vertical: "middle" };
  ws1.getColumn(4).numFmt = "#,##0.00";
  ws1.getColumn(5).numFmt = "#,##0.00";
  ws1.getColumn(6).numFmt = "#,##0.00";
  ws1.getColumn(7).numFmt = "#,##0.00";
  ws1.getColumn(8).numFmt = "0.0";
  ws1.getColumn(9).numFmt = "0.0";
  let t1Count = 0, t1Amount = 0, t1Inv = 0, t1Pay = 0;
  for (const r of summary) {
    const unpaid = Math.max(r.contractAmount - r.paymentAmount, 0);
    const invRate = r.contractAmount > 0 ? (r.invoiceAmount / r.contractAmount) * 100 : 0;
    const payRate = r.invoiceAmount > 0 ? (r.paymentAmount / r.invoiceAmount) * 100 : 0;
    ws1.addRow({
      employeeNo: r.employeeNo,
      name: r.name,
      contractCount: r.contractCount,
      contractAmount: r.contractAmount,
      invoiceAmount: r.invoiceAmount,
      paymentAmount: r.paymentAmount,
      unpaidAmount: unpaid,
      invoiceRate: Number(invRate.toFixed(1)),
      paymentRate: Number(payRate.toFixed(1))
    });
    t1Count += r.contractCount;
    t1Amount += r.contractAmount;
    t1Inv += r.invoiceAmount;
    t1Pay += r.paymentAmount;
  }
  // 总计行 (深灰底加粗)
  const t1Unpaid = Math.max(t1Amount - t1Pay, 0);
  const t1InvRate = t1Amount > 0 ? (t1Inv / t1Amount) * 100 : 0;
  const t1PayRate = t1Inv > 0 ? (t1Pay / t1Inv) * 100 : 0;
  const totalRow1 = ws1.addRow({
    employeeNo: "",
    name: `总计 (${summary.length} 人)`,
    contractCount: t1Count,
    contractAmount: t1Amount,
    invoiceAmount: t1Inv,
    paymentAmount: t1Pay,
    unpaidAmount: t1Unpaid,
    invoiceRate: Number(t1InvRate.toFixed(1)),
    paymentRate: Number(t1PayRate.toFixed(1))
  });
  totalRow1.font = { bold: true };
  totalRow1.eachCell((c) => { c.fill = FILL_TOTAL; });

  // ==== Sheet 2: 签约明细 ====
  const ws2 = wb.addWorksheet("签约明细");
  ws2.columns = [
    { header: "所属区域", key: "region", width: 20 },
    { header: "企业名称", key: "customerName", width: 30 },
    { header: "服务项目", key: "serviceTypeLabel", width: 20 },
    { header: "签约人", key: "signer", width: 14 },
    { header: "合同号", key: "contractNo", width: 18 },
    { header: "签约日期", key: "signDate", width: 14 },
    { header: "合同金额", key: "totalAmount", width: 16 }
  ];
  ws2.getRow(1).font = { bold: true };
  ws2.getRow(1).alignment = { vertical: "middle" };
  ws2.getColumn(6).numFmt = "yyyy-mm-dd";
  ws2.getColumn(7).numFmt = "#,##0.00";
  let t2Count = 0, t2Amount = 0;
  for (const g of detail) {
    for (const r of g.rows) {
      ws2.addRow({
        region: r.region,
        customerName: r.customerName,
        serviceTypeLabel: r.serviceTypeLabel,
        signer: `${g.signerName}（${g.signerEmployeeNo}）`,
        contractNo: r.contractNo,
        signDate: r.signDate,
        totalAmount: r.totalAmount
      });
      t2Count += 1;
      t2Amount += r.totalAmount;
    }
    // 签约人小计行 (浅灰底加粗)
    const subRow = ws2.addRow({
      region: "",
      customerName: `小计: ${g.signerName}`,
      serviceTypeLabel: `${g.rows.length} 份合同`,
      signer: "",
      contractNo: "",
      signDate: "",
      totalAmount: g.contractAmount
    });
    subRow.font = { bold: true };
    subRow.eachCell((c) => { c.fill = FILL_SUBTOTAL; });
  }
  // 全表总计行 (深灰底加粗)
  const totalRow2 = ws2.addRow({
    region: "",
    customerName: `总计: 全公司 (${t2Count} 份合同)`,
    serviceTypeLabel: `${detail.length} 名签约人`,
    signer: "",
    contractNo: "",
    signDate: "",
    totalAmount: t2Amount
  });
  totalRow2.font = { bold: true };
  totalRow2.eachCell((c) => { c.fill = FILL_TOTAL; });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const query = z.object({
  type: z.enum(["overview", "top-customers", "employee-performance", "by-region", "aging"]),
  metric: z.enum(["contract", "payment"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.string().optional(),
  // 账龄导出专属参数
  basis: z.enum(["issue", "due"]).optional(),
  customerId: z.string().optional(),
  ownerUserId: z.string().optional(),
  contractId: z.string().optional(),
  buckets: z.string().optional(),
  minAmount: z.string().optional()
});

// 数字格式化辅助: 给统计页统一保留两位
const num = (v: unknown) => (v != null && v !== "" ? Number(v).toFixed(2) : "");

// 防止单次请求拉百万行(员工表全量 / 全合同) → OOM
// 单租户 < 5000 行时用默认 5000;大组织可在 EXPORT_MAX_ROWS 调高,硬上限 10000
const MAX_ROWS = exportMaxRows();

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.EXPORT);
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const range = parseDateRangeQuery(parsed);
      const ts = exportFileTimestamp();

      if (parsed.type === "overview") {
        const o = await getOverview(user, range);
        const rows = [
          { name: "合同额", value: o.contractAmount, count: o.contractCount },
          { name: "已开票额", value: o.invoiceAmount, count: o.invoiceCount },
          { name: "已回款额", value: o.paymentAmount, count: o.paymentCount },
          { name: "未回款额", value: o.unpaidAmount, count: "" },
          { name: "开票率(%)", value: o.invoiceRate, count: "" },
          { name: "回款率(%)", value: o.paymentRate, count: "" }
        ];
        const buf = await exportToXlsx(rows, [
          { header: "指标", key: "name", width: 20 },
          { header: "金额", key: "value", width: 20, formatter: num },
          { header: "数量", key: "count", width: 12 }
        ]);
        return new Response(new Uint8Array(buf), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": attachmentHeader(`总览_${ts}.xlsx`),
            "Cache-Control": "no-store"
          }
        });
      }
      if (parsed.type === "top-customers") {
        const data = await getTopCustomers(
          user,
          parsed.metric ?? "contract",
          // Top 客户导出走全量,仍受 MAX_ROWS 兜底
          MAX_ROWS,
          range
        );
        const buf = await exportToXlsx(data, [
          { header: "客户编号", key: "code", width: 20 },
          { header: "客户名称", key: "name", width: 30 },
          { header: "合同数", key: "contractCount", width: 10 },
          { header: "合同额", key: "total", width: 18, formatter: num },
          { header: "已开票额", key: "invoiceTotal", width: 18, formatter: num },
          { header: "已回款额", key: "paymentTotal", width: 18, formatter: num }
        ]);
        return new Response(new Uint8Array(buf), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": attachmentHeader(`Top 客户_${ts}.xlsx`),
            "Cache-Control": "no-store"
          }
        });
      }
      if (parsed.type === "by-region") {
        // 受 MAX_ROWS 兜底防 OOM;客户镇街理论上是百量级,正常不会触顶
        const regionRows = await getRegionStatistics(user, range);
        const regionData = regionRows.slice(0, MAX_ROWS);
        const buf = await exportToXlsx(regionData, [
          { header: "区域", key: "region", width: 24 },
          { header: "客户数", key: "customerCount", width: 10 },
          { header: "合同数", key: "contractCount", width: 10 },
          { header: "合同额", key: "contractAmount", width: 18, formatter: num },
          { header: "已开票额", key: "invoiceAmount", width: 18, formatter: num },
          { header: "已回款额", key: "paymentAmount", width: 18, formatter: num },
          { header: "开票率(%)", key: "invoiceRate", width: 12, formatter: num },
          { header: "回款率(%)", key: "paymentRate", width: 12, formatter: num },
          { header: "未回款额", key: "unpaidAmount", width: 18, formatter: num }
        ]);
        return new Response(new Uint8Array(buf), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": attachmentHeader(`区域统计_${ts}.xlsx`),
            "Cache-Control": "no-store"
          }
        });
      }
      if (parsed.type === "aging") {
        // 导出账龄明细(走 getInvoiceAging, 应用与页面同口径的过滤)
        const minAmount = parsed.minAmount ? Number(parsed.minAmount) : undefined;
        if (minAmount !== undefined && Number.isNaN(minAmount)) {
          throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "minAmount 必须是有效数字", 400);
        }
        const agingResult = await getInvoiceAging(user, {
          basis: parsed.basis as "issue" | "due" | undefined,
          customerId: parsed.customerId,
          ownerUserId: parsed.ownerUserId,
          contractId: parsed.contractId,
          buckets: parsed.buckets
            ? parsed.buckets.split(",").map((s) => s.trim()).filter(Boolean)
            : undefined,
          minAmount,
          pageSize: MAX_ROWS
        });
        const basisTag = agingResult.basisUsed;
        const rows = agingResult.rows.map((r: typeof agingResult.rows[number]) => ({
          发票号: r.invoiceNo,
          客户: r.customerName,
          合同号: r.contractNo ?? "-",
          业务人员: r.ownerName,
          账龄段: r.bucket,
          逾期天数: r.daysOverdue,
          剩余未收: r.remaining.toFixed(2),
          状态: r.status,
          基准: r.basisUsed,
          已有催收: r.hasDunning ? "是" : "否",
          最新催收状态: r.latestDunningStatus ?? "-"
        }));
        const buf = await exportToXlsx(rows, [
          { header: "发票号", key: "发票号", width: 22 },
          { header: "客户", key: "客户", width: 24 },
          { header: "合同号", key: "合同号", width: 22 },
          { header: "业务人员", key: "业务人员", width: 12 },
          { header: "账龄段", key: "账龄段", width: 10 },
          { header: "逾期天数", key: "逾期天数", width: 10 },
          { header: "剩余未收", key: "剩余未收", width: 14 },
          { header: "状态", key: "状态", width: 12 },
          { header: "基准", key: "基准", width: 10 },
          { header: "已有催收", key: "已有催收", width: 10 },
          { header: "最新催收状态", key: "最新催收状态", width: 16 }
        ]);
        return new Response(new Uint8Array(buf), {
          headers: {
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": attachmentHeader(`账龄分析_${basisTag}_${ts}.xlsx`),
            "Cache-Control": "no-store"
          }
        });
      }
      // employee-performance (重新设计: 2 sheet, 含小计+总计)
      // Sheet 1 「员工业绩汇总」: 每员工一行, 末行总计 (与页面表格 / PDF 顶部 KPI 同口径, signer 维度)
      // Sheet 2 「签约明细」: 按签约人分组, 每组末行小计, 末行总计
      const [empSummary, empDetail] = await Promise.all([
        getSignerSummary(user, range),
        getSignerContractDetail(user, range)
      ]);
      const buf = await buildEmployeePerformanceXlsx(empSummary, empDetail);
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": attachmentHeader(`员工业绩_${ts}.xlsx`),
          "Cache-Control": "no-store"
        }
      });
    } catch (e) {
      return err(e);
    }
  });
}
