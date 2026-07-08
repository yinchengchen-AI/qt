
// 发票详情 → 打印页 HTML
import { err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import {
  INVOICE_TYPE_MAP,
  INVOICE_STATUS_MAP,
  PAYMENT_STATUS_MAP,
} from "@/lib/enum-maps";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { getInvoice } from "@/server/services/invoice";
import { prisma } from "@/lib/prisma";
import { renderPrintHtml, type PrintDoc } from "@/lib/print-html";
import { formatDate, formatDateTime } from "@/lib/format";

const TITLE_TYPE_MAP: Record<string, string> = {
  COMPANY: "公司",
  PERSONAL: "个人",
};

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.INVOICE, ACTION.EXPORT);
      const { id } = await params;
      const inv = await getInvoice(user, id);
      const contract = await prisma.contract.findUnique({
        where: { id: inv.contractId },
        select: { contractNo: true },
      });
      const [applicant, finance, payments] = await Promise.all([
        prisma.user.findUnique({
          where: { id: inv.applicantUserId },
          select: { name: true, employeeNo: true },
        }),
        inv.financeUserId
          ? prisma.user.findUnique({
              where: { id: inv.financeUserId },
              select: { name: true, employeeNo: true },
            })
          : null,
        prisma.payment.findMany({
          where: { invoiceId: id, deletedAt: null },
          select: {
            paymentNo: true,
            amount: true,
            receivedAt: true,
            status: true,
          },
        }),
      ]);

      const doc: PrintDoc = {
        title: `发票 - ${inv.invoiceNo ?? "未开"}`,
        subtitle: `客户: ${inv.customerName} · 合同: ${contract?.contractNo ?? inv.contractId}`,
        mainRows: [
          { label: "发票号", value: inv.invoiceNo ?? "未开" },
          { label: "客户", value: inv.customerName },
          { label: "合同号", value: contract?.contractNo ?? inv.contractId },
          {
            label: "发票类型",
            value: INVOICE_TYPE_MAP[inv.invoiceType] ?? inv.invoiceType,
          },
          { label: "含税金额", value: Number(inv.amount).toFixed(2) },
          {
            label: "税率",
            value: (Number(inv.taxRate) * 100).toFixed(2) + "%",
          },
          { label: "税额", value: Number(inv.taxAmount).toFixed(2) },
          {
            label: "不含税金额",
            value: Number(inv.amountExcludingTax).toFixed(2),
          },
          {
            label: "申请日",
            value: formatDate(inv.applyDate),
          },
          {
            label: "实际开票日",
            value: inv.actualIssueDate
              ? formatDate(inv.actualIssueDate)
              : "—",
          },
          {
            label: "状态",
            value: INVOICE_STATUS_MAP[inv.status] ?? inv.status,
          },
          {
            label: "申请人",
            value: applicant
              ? `${applicant.name} (${applicant.employeeNo})`
              : inv.applicantUserId,
          },
          {
            label: "财务审核人",
            value: finance ? `${finance.name} (${finance.employeeNo})` : "—",
          },
          { label: "审核意见", value: inv.reviewComment ?? "—" },
          {
            label: "抬头类型",
            value: TITLE_TYPE_MAP[inv.titleType] ?? inv.titleType,
          },
          { label: "抬头名称", value: inv.titleName },
          { label: "税号", value: inv.taxNo ?? "—" },
          { label: "开户行", value: inv.bankName ?? "—" },
          { label: "银行账号", value: inv.bankAccount ?? "—" },
          { label: "地址", value: inv.address ?? "—" },
          { label: "电话", value: inv.phone ?? "—" },
          { label: "备注", value: inv.remark ?? "—" },
        ],
        sections: [
          {
            title: "回款记录",
            rows: payments.length
              ? payments.map((p) => ({
                  label: p.paymentNo,
                  value: `¥${Number(p.amount).toFixed(2)} · 到账 ${formatDateTime(p.receivedAt)} · ${PAYMENT_STATUS_MAP[p.status] ?? p.status}`,
                }))
              : [{ label: "(无)", value: "" }],
          },
        ],
      };
      return new Response(renderPrintHtml(doc), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      return err(e);
    }
  });
}
