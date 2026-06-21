// 发票列表导出 XLSX
import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { listInvoices } from "@/server/services/invoice";
import { exportToXlsx } from "@/lib/excel";
import { INVOICE_TYPE_MAP, TITLE_TYPE_MAP } from "@/lib/enum-maps";

const query = z.object({
  keyword: z.string().optional(),
  status: z.string().optional(),
  contractId: z.string().optional(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.INVOICE, ACTION.EXPORT);
      const url = new URL(req.url);
      const params = query.parse(Object.fromEntries(url.searchParams));
      const { list } = await listInvoices(user, {
        page: 1,
        pageSize: 10000,
        ...params,
      });
      const ts = new Date().toISOString().slice(0, 10);
      const buf = await exportToXlsx(
        list as unknown as Record<string, unknown>[],
        [
          { header: "发票号", key: "invoiceNo", width: 22 },
          { header: "客户", key: "customerName", width: 24 },
          { header: "合同号", key: "contractNo", width: 22 },
          {
            header: "发票类型",
            key: "invoiceType",
            width: 16,
            formatter: (v) =>
              v ? (INVOICE_TYPE_MAP[v as string] ?? (v as string)) : "",
          },
          {
            header: "含税金额",
            key: "amount",
            width: 14,
            formatter: (v) =>
              v != null && v !== "" ? Number(v).toFixed(2) : "",
          },
          {
            header: "税率",
            key: "taxRate",
            width: 10,
            formatter: (v) =>
              v != null && v !== "" ? (Number(v) * 100).toFixed(2) + "%" : "",
          },
          {
            header: "税额",
            key: "taxAmount",
            width: 14,
            formatter: (v) =>
              v != null && v !== "" ? Number(v).toFixed(2) : "",
          },
          {
            header: "不含税金额",
            key: "amountExcludingTax",
            width: 14,
            formatter: (v) =>
              v != null && v !== "" ? Number(v).toFixed(2) : "",
          },
          {
            header: "抬头类型",
            key: "titleType",
            width: 10,
            formatter: (v) =>
              v ? (TITLE_TYPE_MAP[v as string] ?? (v as string)) : "",
          },
          { header: "抬头名称", key: "titleName", width: 24 },
          { header: "税号", key: "taxNo", width: 22 },
          {
            header: "申请日",
            key: "applyDate",
            width: 14,
            formatter: (v) =>
              v ? new Date(v as string).toLocaleDateString("zh-CN") : "",
          },
          {
            header: "实际开票日",
            key: "actualIssueDate",
            width: 14,
            formatter: (v) =>
              v ? new Date(v as string).toLocaleDateString("zh-CN") : "",
          },
          {
            header: "状态",
            key: "status",
            width: 10,
            formatter: (v) =>
              v
                ? ({
                    DRAFT: "草稿",
                    PENDING_FINANCE: "财务待审",
                    ISSUED: "已开票",
                    REJECTED: "已驳回",
                    VOIDED: "已作废",
                    RED_FLUSHED: "已红冲",
                  }[v as string] ?? (v as string))
                : "",
          },
        ],
        `发票列表_${ts}.xlsx`,
      );
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename=invoices_${ts}.xlsx`,
        },
      });
    } catch (e) {
      return err(e);
    }
  });
}
