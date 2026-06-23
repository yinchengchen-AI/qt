import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import {
  getTopCustomers,
  getEmployeePerformance,
  getOverview,
} from "@/server/services/statistics";
import { exportToXlsx } from "@/lib/excel";

const query = z.object({
  type: z.enum(["overview", "top-customers", "employee-performance"]),
  metric: z.enum(["contract", "payment"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

// 数字格式化辅助: 给统计页统一保留两位
const num = (v: unknown) => (v != null && v !== "" ? Number(v).toFixed(2) : "");

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.EXPORT);
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const from = parsed.from ? new Date(parsed.from) : undefined;
      const to = parsed.to ? new Date(parsed.to) : undefined;
      const ts = new Date().toISOString().slice(0, 10);

      if (parsed.type === "overview") {
        const o = await getOverview(user, { from, to });
        const rows = [
          { name: "合同额", value: o.contractAmount, count: o.contractCount },
          { name: "已开票额", value: o.invoiceAmount, count: o.invoiceCount },
          { name: "已回款额", value: o.paymentAmount, count: o.paymentCount },
          { name: "未回款额", value: o.unpaidAmount, count: "" },
          { name: "开票率(%)", value: o.invoiceRate, count: "" },
          { name: "回款率(%)", value: o.paymentRate, count: "" },
        ];
        const buf = await exportToXlsx(rows, [
          { header: "指标", key: "name", width: 20 },
          { header: "金额", key: "value", width: 20, formatter: num },
          { header: "数量", key: "count", width: 12 },
        ]);
        return new Response(new Uint8Array(buf), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="overview-${ts}.xlsx"`,
            "Cache-Control": "no-store",
          },
        });
      }
      if (parsed.type === "top-customers") {
        const data = await getTopCustomers(
          user,
          parsed.metric ?? "contract",
          50,
        );
        const buf = await exportToXlsx(data, [
          { header: "客户编号", key: "code", width: 20 },
          { header: "客户名称", key: "name", width: 30 },
          { header: "合同数", key: "contractCount", width: 10 },
          { header: "合同额", key: "total", width: 18, formatter: num },
          { header: "已开票额", key: "invoiceTotal", width: 18, formatter: num },
          { header: "已回款额", key: "paymentTotal", width: 18, formatter: num },
        ]);
        return new Response(new Uint8Array(buf), {
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Disposition": `attachment; filename="top-customers-${ts}.xlsx"`,
            "Cache-Control": "no-store",
          },
        });
      }
      // employee-performance
      const data = await getEmployeePerformance(user, undefined, { from, to });
      const buf = await exportToXlsx(data, [
        { header: "工号", key: "employeeNo", width: 12 },
        { header: "姓名", key: "name", width: 14 },
        { header: "合同数", key: "contractCount", width: 10 },
        { header: "合同额", key: "contractAmount", width: 18, formatter: num },
        { header: "已开票额", key: "invoiceAmount", width: 18, formatter: num },
        { header: "已回款额", key: "paymentAmount", width: 18, formatter: num },
      ]);
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="employee-performance-${ts}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return err(e);
    }
  });
}
