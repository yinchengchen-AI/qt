// 回款列表导出 XLSX
import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { listPayments } from "@/server/services/payment";
import { exportToXlsx } from "@/lib/excel";
import { METHOD_MAP } from "@/lib/enum-maps";

const query = z.object({
  keyword: z.string().optional(),
  status: z.string().optional(),
  contractId: z.string().optional(),
  invoiceId: z.string().optional(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.PAYMENT, ACTION.EXPORT);
      const url = new URL(req.url);
      const params = query.parse(Object.fromEntries(url.searchParams));
      const { list } = await listPayments(user, {
        page: 1,
        pageSize: 10000,
        ...params,
      });
      const ts = new Date().toISOString().slice(0, 10);
      const buf = await exportToXlsx(
        list as unknown as Record<string, unknown>[],
        [
          { header: "回款号", key: "paymentNo", width: 22 },
          {
            header: "金额",
            key: "amount",
            width: 14,
            formatter: (v) =>
              v != null && v !== "" ? Number(v).toFixed(2) : "",
          },
          {
            header: "收款方式",
            key: "method",
            width: 12,
            formatter: (v) =>
              v ? (METHOD_MAP[v as string] ?? (v as string)) : "",
          },
          {
            header: "到账日",
            key: "receivedAt",
            width: 20,
            formatter: (v) =>
              v ? new Date(v as string).toLocaleString("zh-CN") : "",
          },
          { header: "银行流水号", key: "bankRefNo", width: 22 },
          { header: "收款行", key: "bankName", width: 22 },
          { header: "关联发票号", key: "invoiceNo", width: 22 },
          {
            header: "状态",
            key: "status",
            width: 10,
            formatter: (v) =>
              v
                ? ({
                    PLANNED: "计划中",
                    CONFIRMED: "已确认",
                    RECONCILED: "已对账",
                    REFUNDED: "已退款",
                    CANCELLED: "已取消",
                  }[v as string] ?? (v as string))
                : "",
          },
          { header: "备注", key: "remark", width: 24 },
        ],
        `回款列表_${ts}.xlsx`,
      );
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename=payments_${ts}.xlsx`,
        },
      });
    } catch (e) {
      return err(e);
    }
  });
}
