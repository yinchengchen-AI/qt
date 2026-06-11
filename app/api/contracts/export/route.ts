// 合同列表导出 XLSX — 入参与 GET /api/contracts 对齐
import { z } from "zod";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { listContracts } from "@/server/services/contract";
import { exportToXlsx } from "@/lib/excel";
import { SERVICE_TYPE_MAP, PAYMENT_METHOD_MAP } from "@/lib/enum-maps";

const query = z.object({
  keyword: z.string().optional(),
  status: z.string().optional(),
  customerId: z.string().optional()
});

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.EXPORT);
    const url = new URL(req.url);
    const params = query.parse(Object.fromEntries(url.searchParams));
    const { list } = await listContracts(user, { page: 1, pageSize: 10000, ...params });
    const ts = new Date().toISOString().slice(0, 10);
    const buf = await exportToXlsx(
      list as unknown as Record<string, unknown>[],
      [
        { header: "合同号", key: "contractNo", width: 22 },
        { header: "客户", key: "customerName", width: 24 },
        { header: "合同标题", key: "title", width: 32 },
        { header: "服务类型", key: "serviceType", width: 14, formatter: (v) => v ? (SERVICE_TYPE_MAP[v as string] ?? v as string) : "" },
        { header: "签订日", key: "signDate", width: 14, formatter: (v) => v ? new Date(v as string).toLocaleDateString("zh-CN") : "" },
        { header: "服务起期", key: "startDate", width: 14, formatter: (v) => v ? new Date(v as string).toLocaleDateString("zh-CN") : "" },
        { header: "服务止期", key: "endDate", width: 14, formatter: (v) => v ? new Date(v as string).toLocaleDateString("zh-CN") : "" },
        { header: "含税总额", key: "totalAmount", width: 16, formatter: (v) => v != null && v !== "" ? Number(v).toFixed(2) : "" },
        { header: "税率", key: "taxRate", width: 10, formatter: (v) => v != null && v !== "" ? (Number(v) * 100).toFixed(2) + "%" : "" },
        { header: "税额", key: "taxAmount", width: 14, formatter: (v) => v != null && v !== "" ? Number(v).toFixed(2) : "" },
        { header: "不含税金额", key: "amountExcludingTax", width: 16, formatter: (v) => v != null && v !== "" ? Number(v).toFixed(2) : "" },
        { header: "付款方式", key: "paymentMethod", width: 12, formatter: (v) => v ? (PAYMENT_METHOD_MAP[v as string] ?? v as string) : "" },
        { header: "状态", key: "status", width: 10, formatter: (v) => v ? ({DRAFT:"草稿",PENDING_REVIEW:"待审批",EFFECTIVE:"已生效",EXECUTING:"执行中",COMPLETED:"已完成",TERMINATED:"已终止",EXPIRED:"已过期"}[v as string] ?? v as string) : "" }
      ],
      `合同列表_${ts}.xlsx`
    );
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=contracts_${ts}.xlsx`
      }
    });
  } catch (e) {
    return err(e);
  }
}
