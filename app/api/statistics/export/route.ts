import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import {
  getTopCustomers,
  getEmployeePerformance,
  getOverview,
  getRegionStatistics,
} from "@/server/services/statistics";
import { exportToXlsx, exportMaxRows, attachmentHeader } from "@/lib/excel";
import { parseDateRangeQuery } from "@/lib/date-range";

const query = z.object({
  type: z.enum(["overview", "top-customers", "employee-performance", "by-region"]),
  metric: z.enum(["contract", "payment"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.string().optional()
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
      const ts = new Date().toISOString().slice(0, 10);

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
      // employee-performance
      // parsed.userId 未传时拉全员,受 MAX_ROWS 兜底防 OOM
      const all = await getEmployeePerformance(user, parsed.userId, range);
      const data = all.slice(0, MAX_ROWS);
      const buf = await exportToXlsx(data, [
        { header: "工号", key: "employeeNo", width: 12 },
        { header: "姓名", key: "name", width: 14 },
        { header: "合同数", key: "contractCount", width: 10 },
        { header: "合同额", key: "contractAmount", width: 18, formatter: num },
        { header: "已开票额", key: "invoiceAmount", width: 18, formatter: num },
        { header: "已回款额", key: "paymentAmount", width: 18, formatter: num }
      ]);
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
