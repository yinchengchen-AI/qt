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
  getPerformanceRanking,
  getPerformanceContractDetail
} from "@/server/services/statistics";
import type { PerformanceRankingRow, PerformanceDetailGroup } from "@/server/services/statistics";
import ExcelJS from "exceljs";
import { exportToXlsx, exportMaxRows, attachmentHeader } from "@/lib/excel";
import { parseDateRangeQuery, exportFileTimestamp, resolveStatsRange } from "@/lib/date-range";

// 小计/总计行底色: 浅灰 (#E5E7EB) = 小计, 深灰 (#D1D5DB) = 总计, 均加粗
const FILL_SUBTOTAL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
const FILL_TOTAL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1D5DB" } };

// 业绩排行 xlsx 导出: 2 sheet
//   Sheet 1 「业绩排行」: 排行表 (名次 + 金额 + 开票率/回款率), 与页面同口径
//   Sheet 2 「业务明细」: 合同级明细, 按排行维度分组 (owner/signer → 员工, region → 区域),
//     组末小计 + 末行总计; 明细行数受 maxRows 兜底防 OOM, 截断时总计行标注
async function buildPerformanceRankingXlsx(
  dimension: "owner" | "signer" | "region",
  ranking: PerformanceRankingRow[],
  detail: PerformanceDetailGroup[],
  maxRows: number
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const showRegion = dimension === "region";

  // ==== Sheet 1: 业绩排行 ====
  const ws1 = wb.addWorksheet("业绩排行");
  ws1.columns = [
    { header: "名次", key: "rank", width: 8 },
    { header: showRegion ? "区域" : "姓名", key: "name", width: 20 },
    showRegion
      ? { header: "客户数", key: "customerCount", width: 10 }
      : { header: "工号", key: "employeeNo", width: 14 },
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
  ws1.getColumn(5).numFmt = "#,##0.00";
  ws1.getColumn(6).numFmt = "#,##0.00";
  ws1.getColumn(7).numFmt = "#,##0.00";
  ws1.getColumn(8).numFmt = "#,##0.00";
  ws1.getColumn(9).numFmt = "0.00";
  ws1.getColumn(10).numFmt = "0.00";
  for (const r of ranking) {
    ws1.addRow({
      rank: r.rank,
      name: r.name,
      ...(showRegion ? { customerCount: r.customerCount ?? 0 } : { employeeNo: r.employeeNo ?? "" }),
      contractCount: r.contractCount,
      contractAmount: r.contractAmount,
      invoiceAmount: r.invoiceAmount,
      paymentAmount: r.paymentAmount,
      unpaidAmount: r.unpaidAmount,
      invoiceRate: r.invoiceRate,
      paymentRate: r.paymentRate
    });
  }

  // ==== Sheet 2: 业务明细 ====
  // 行数兜底: 超出 maxRows 的明细直接截断 (排行 sheet 不受影响), 总计行如实标注
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

  const ws2 = wb.addWorksheet("业务明细");
  ws2.columns = [
    { header: "所属区域", key: "region", width: 20 },
    { header: "企业名称", key: "customerName", width: 30 },
    { header: "服务项目", key: "serviceTypeLabel", width: 20 },
    { header: "负责人", key: "ownerName", width: 12 },
    { header: "签约人", key: "signerName", width: 12 },
    { header: "合同号", key: "contractNo", width: 18 },
    { header: "签约日期", key: "signDate", width: 14 },
    { header: "合同金额", key: "totalAmount", width: 16 }
  ];
  ws2.getRow(1).font = { bold: true };
  ws2.getRow(1).alignment = { vertical: "middle" };
  ws2.getColumn(7).numFmt = "yyyy-mm-dd";
  ws2.getColumn(8).numFmt = "#,##0.00";
  let t2Count = 0, t2Amount = 0;
  for (const g of shownGroups) {
    // 小计按实际显示的明细行重算 (截断时与 sheet 所见一致)
    let gAmount = 0;
    for (const r of g.rows) {
      ws2.addRow({
        region: r.region,
        customerName: r.customerName,
        serviceTypeLabel: r.serviceTypeLabel,
        ownerName: r.ownerName,
        signerName: r.signerName,
        contractNo: r.contractNo,
        signDate: new Date(r.signDate),             // 转 Date 让 numFmt "yyyy-mm-dd" 生效
        totalAmount: r.totalAmount
      });
      gAmount += r.totalAmount;
      t2Count += 1;
      t2Amount += r.totalAmount;
    }
    // 分组小计行 (浅灰底加粗)
    const subRow = ws2.addRow({
      region: "",
      customerName: `小计: ${g.label}`,
      serviceTypeLabel: `${g.rows.length} 份合同`,
      ownerName: "",
      signerName: "",
      contractNo: "",
      signDate: "",
      totalAmount: Number(gAmount.toFixed(2))
    });
    subRow.font = { bold: true };
    subRow.eachCell((c) => { c.fill = FILL_SUBTOTAL; });
  }
  // 全表总计行 (深灰底加粗)
  const groupUnit = showRegion ? "个区域" : "名员工";
  const totalRow2 = ws2.addRow({
    region: "",
    customerName: truncated
      ? `总计 (显示 ${t2Count} / 共 ${totalContracts} 份合同)`
      : `总计 (${t2Count} 份合同)`,
    serviceTypeLabel: `${shownGroups.length} ${groupUnit}`,
    ownerName: "",
    signerName: "",
    contractNo: "",
    signDate: "",
    totalAmount: Number(t2Amount.toFixed(2))
  });
  totalRow2.font = { bold: true };
  totalRow2.eachCell((c) => { c.fill = FILL_TOTAL; });

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

const query = z.object({
  type: z.enum(["overview", "top-customers", "by-region", "aging", "performance"]),
  metric: z.enum(["contract", "payment"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  preset: z.enum(["month", "quarter", "year"]).optional(),
  userId: z.string().optional(),
  // 性能排行导出专属
  dimension: z.enum(["owner", "signer", "region"]).optional(),
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
      // performance (统一业绩排行: owner/signer/region 三维度, 支持 preset 快捷区间)
      // Sheet 1 「业绩排行」: 排行表 (rank + 金额 + 开票率/回款率), 走 getPerformanceRanking 全量后截断 MAX_ROWS
      // Sheet 2 「业务明细」: 合同级明细, 按维度分组 + 组末小计 + 末行总计, 走 getPerformanceContractDetail
      if (parsed.type === "performance") {
        const perfRange = resolveStatsRange(parsed);
        const dimension = parsed.dimension ?? "owner";
        const [ranking, detail] = await Promise.all([
          getPerformanceRanking(user, dimension, perfRange, MAX_ROWS),
          getPerformanceContractDetail(user, dimension, perfRange)
        ]);
        const buf = await buildPerformanceRankingXlsx(dimension, ranking, detail, MAX_ROWS);
        return new Response(new Uint8Array(buf), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": attachmentHeader(`业绩排行_${dimension}_${ts}.xlsx`),
            "Cache-Control": "no-store"
          }
        });
      }
    } catch (e) {
      return err(e);
    }
  });
}
