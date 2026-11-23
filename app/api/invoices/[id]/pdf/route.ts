
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
import {
  pfAmount,
  pfDate,
  pfDateTime,
  pfPercent,
  pfPerson,
  pfText,
} from "@/lib/print-format";

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
          { label: "含税金额", value: pfAmount(inv.amount) },
          {
            label: "税率",
            value: pfPercent(inv.taxRate),
          },
          { label: "税额", value: pfAmount(inv.taxAmount) },
          {
            label: "不含税金额",
            value: pfAmount(inv.amountExcludingTax),
          },
          {
            label: "申请日",
            value: pfDate(inv.applyDate),
          },
          {
            label: "实际开票日",
            value: pfDate(inv.actualIssueDate),
          },
          {
            label: "状态",
            value: INVOICE_STATUS_MAP[inv.status] ?? inv.status,
          },
          {
            label: "申请人",
            value: applicant ? pfPerson(applicant) : inv.applicantUserId,
          },
          {
            label: "财务审核人",
            value: pfPerson(finance),
          },
          { label: "审核意见", value: pfText(inv.reviewComment) },
          {
            label: "抬头类型",
            value: TITLE_TYPE_MAP[inv.titleType] ?? inv.titleType,
          },
          { label: "抬头名称", value: pfText(inv.titleName) },
          { label: "税号", value: pfText(inv.taxNo) },
          { label: "开户行", value: pfText(inv.bankName) },
          { label: "银行账号", value: pfText(inv.bankAccount) },
          { label: "地址", value: pfText(inv.address) },
          { label: "电话", value: pfText(inv.phone) },
          { label: "备注", value: pfText(inv.remark) },
        ],
        sections: [
          {
            title: "回款记录",
            rows: payments.map((p) => ({
              label: p.paymentNo,
              value: `${pfAmount(p.amount)} · 到账 ${pfDateTime(p.receivedAt)} · ${PAYMENT_STATUS_MAP[p.status] ?? p.status}`,
            })),
            emptyText: "(暂无回款记录)",
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
