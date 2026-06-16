// 合同列表导出 XLSX — 入参与 GET /api/contracts 对齐
import { z } from "zod";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { listContracts } from "@/server/services/contract";
import { getBillingStatus } from "@/lib/contract-billing";
import { exportToXlsx, exportMaxRows } from "@/lib/excel";
import { prisma } from "@/lib/prisma";
import { SERVICE_TYPE_MAP, PAYMENT_METHOD_MAP, CONTRACT_STATUS_MAP, BILLING_STATUS_MAP } from "@/lib/enum-maps";

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
    // pageSize 用 exportMaxRows() 兜底,防止单次导出 OOM
    const max = exportMaxRows();
    const { list, total: _total } = await listContracts(user, { page: 1, pageSize: max, ...params });
    // listContracts 已返回 invoicedAmount / paidAmount;按 totalAmount 补一份开票状态
    // totalAmount 是 Prisma.Decimal,Number() 接受 any(Decimal 有 valueOf),无需 cast
    const enriched = list.map((c) => ({
      ...c,
      billingStatus: getBillingStatus(c.invoicedAmount, Number(c.totalAmount))
    }));
    // 批量把签订人 id 解析成姓名(employeeNo),避免导出 N+1
    const signerIds = [...new Set(list.map((c) => (c as { signerId?: string | null }).signerId).filter((v): v is string => Boolean(v)))];
    const signers = signerIds.length
      ? await prisma.user.findMany({ where: { id: { in: signerIds } }, select: { id: true, name: true, employeeNo: true } })
      : [];
    const signerById = new Map(signers.map((u) => [u.id, u]));
    const ts = new Date().toISOString().slice(0, 10);
    const buf = await exportToXlsx(
      enriched as unknown as Record<string, unknown>[],
      [
        { header: "合同号", key: "contractNo", width: 22 },
        { header: "客户", key: "customerName", width: 24 },
        { header: "合同标题", key: "title", width: 32 },
        { header: "服务类型", key: "serviceType", width: 14, formatter: (v) => v ? (SERVICE_TYPE_MAP[v as string] ?? v as string) : "" },
        { header: "签订人", key: "signerId", width: 16, formatter: (_v, r) => {
          const id = (r as { signerId?: string | null }).signerId;
          if (!id) return "";
          const u = signerById.get(id);
          return u ? `${u.name}(${u.employeeNo})` : "";
        } },
        { header: "签订日", key: "signDate", width: 14, formatter: (v) => v ? new Date(v as string).toLocaleDateString("zh-CN") : "" },
        { header: "服务起期", key: "startDate", width: 14, formatter: (v) => v ? new Date(v as string).toLocaleDateString("zh-CN") : "" },
        { header: "服务止期", key: "endDate", width: 14, formatter: (v) => v ? new Date(v as string).toLocaleDateString("zh-CN") : "" },
        { header: "含税总额", key: "totalAmount", width: 16, formatter: (v) => v != null && v !== "" ? Number(v).toFixed(2) : "" },
        { header: "已开票金额", key: "invoicedAmount", width: 16, formatter: (v) => v != null ? Number(v).toFixed(2) : "" },
        { header: "已回款金额", key: "paidAmount", width: 16, formatter: (v) => v != null ? Number(v).toFixed(2) : "" },
        { header: "开票状态", key: "billingStatus", width: 12, formatter: (v) => v ? (BILLING_STATUS_MAP[v as string] ?? v as string) : "" },
        { header: "税率", key: "taxRate", width: 10, formatter: (v) => v != null && v !== "" ? (Number(v) * 100).toFixed(2) + "%" : "" },
        { header: "税额", key: "taxAmount", width: 14, formatter: (v) => v != null && v !== "" ? Number(v).toFixed(2) : "" },
        { header: "不含税金额", key: "amountExcludingTax", width: 16, formatter: (v) => v != null && v !== "" ? Number(v).toFixed(2) : "" },
        { header: "付款方式", key: "paymentMethod", width: 12, formatter: (v) => v ? (PAYMENT_METHOD_MAP[v as string] ?? v as string) : "" },
        { header: "状态", key: "status", width: 10, formatter: (v) => v ? (CONTRACT_STATUS_MAP[v as string] ?? v as string) : "" }
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
