
// 合同详情 → 打印页 HTML
import { err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { getContract, getContractOverview } from "@/server/services/contract";
import { prisma } from "@/lib/prisma";
import { renderPrintHtml, type PrintDoc } from "@/lib/print-html";
import { serviceTypeLabel, PAYMENT_METHOD_MAP, CONTRACT_STATUS_MAP, INVOICE_STATUS_MAP, PAYMENT_STATUS_MAP, REVIEW_ACTION_MAP } from "@/lib/enum-maps";
import {
  pfAmount,
  pfDate,
  pfDateTime,
  pfPercent,
  pfPerson,
  pfText,
} from "@/lib/print-format";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.EXPORT);
      const { id } = await params;
      const c = await getContract(user, id);
      const overview = await getContractOverview(user, id);
      const [owner, signer, reviewer, attachments] = await Promise.all([
        prisma.user.findUnique({
          where: { id: c.ownerUserId },
          select: { name: true, employeeNo: true },
        }),
        c.signerId
          ? prisma.user.findUnique({
              where: { id: c.signerId },
              select: { name: true, employeeNo: true },
            })
          : Promise.resolve(null),
        c.reviewerId
          ? prisma.user.findUnique({
              where: { id: c.reviewerId },
              select: { name: true, employeeNo: true },
            })
          : Promise.resolve(null),
        prisma.attachment.findMany({
          where: { contractId: id, deletedAt: null },
          select: {
            originalName: true,
            mimeType: true,
            size: true,
            uploadedAt: true,
          },
          orderBy: { uploadedAt: "desc" },
        }),
      ]);

      const t = overview.totals;
      const remainingInvoice = Math.max(t.totalAmount - t.invoicedAmount, 0);
      const remainingPayment = Math.max(t.totalAmount - t.paidAmount, 0);
      const doc: PrintDoc = {
        title: `合同 - ${c.contractNo}`,
        subtitle: `${c.title} · 客户: ${c.customerName}`,
        meta: [
          { label: "合同号:", value: c.contractNo },
          { label: "业务员:", value: pfPerson(owner) },
          { label: "签订人:", value: pfPerson(signer) },
        ],
        mainRows: [
          { label: "合同标题", value: c.title },
          { label: "客户", value: c.customerName },
          {
            label: "服务类型",
            value: serviceTypeLabel(c.serviceType),
          },
          {
            label: "签订人",
            value: pfPerson(signer),
          },
          { label: "签订日", value: pfDate(c.signDate) },
          { label: "服务起期", value: pfDate(c.startDate) },
          { label: "服务止期", value: pfDate(c.endDate) },
          { label: "含税总额", value: pfAmount(c.totalAmount) },
          { label: "税率", value: pfPercent(c.taxRate) },
          { label: "税额", value: pfAmount(c.taxAmount) },
          {
            label: "不含税金额",
            value: pfAmount(c.amountExcludingTax),
          },
          {
            label: "付款方式",
            value: pfText(PAYMENT_METHOD_MAP[c.paymentMethod] ?? c.paymentMethod),
          },
          { label: "状态", value: pfText(CONTRACT_STATUS_MAP[c.status] ?? c.status) },
          {
            label: "审批人",
            value: reviewer ? pfPerson(reviewer) : pfText(c.reviewerId),
          },
          {
            label: "审批时间",
            value: pfDateTime(c.reviewAt),
          },
          { label: "审批意见", value: pfText(c.reviewComment) },
          { label: "合同备注", value: pfText(c.remark) },
        ],
        summary: [
          {
            label: "含税总额",
            value: pfAmount(c.totalAmount),
            tone: "primary",
          },
          {
            label: "已开票",
            value: pfAmount(t.invoicedAmount),
            tone: "warning",
          },
          {
            label: "未开票",
            value: pfAmount(remainingInvoice),
            tone: "danger",
          },
          { label: "已回款", value: pfAmount(t.paidAmount), tone: "success" },
          {
            label: "未回款",
            value: pfAmount(remainingPayment),
            tone: "danger",
          },
        ],
        sections: [
          {
            title: "开票记录",
            columns: ["发票号", "申请日", "开票日", "金额", "状态"],
            rows: overview.invoices.map((i) => ({
              发票号: i.invoiceNo ?? "未开",
              申请日: pfDate(i.applyDate),
              开票日: pfDate(i.actualIssueDate),
              金额: pfAmount(i.amount),
              状态: INVOICE_STATUS_MAP[i.status] ?? i.status,
            })),
            emptyText: "暂无开票记录",
          },
          {
            title: "回款记录",
            columns: ["回单号", "到账日", "金额", "状态"],
            rows: overview.payments.map((p) => ({
              回单号: p.paymentNo,
              到账日: pfDate(p.receiveDate),
              金额: pfAmount(p.amount),
              状态: PAYMENT_STATUS_MAP[p.status] ?? p.status,
            })),
            emptyText: "暂无回款记录",
          },
          {
            title: "附件清单",
            columns: ["文件名", "类型", "大小", "上传时间"],
            rows: attachments.map((a) => ({
              文件名: a.originalName,
              类型: a.mimeType,
              大小: (a.size / 1024).toFixed(1),
              上传时间: pfDateTime(a.uploadedAt),
            })),
            emptyText: "暂无附件",
          },
          {
            title: "审批记录",
            rows:
              c.reviewLogs && c.reviewLogs.length
                ? c.reviewLogs.map((l) => ({
                    label: pfDateTime(l.at),
                    value: `${REVIEW_ACTION_MAP[l.action] ?? l.action} · ${l.reviewerName || l.reviewerId}${l.comment ? " · " + l.comment : ""}`,
                  }))
                : [],
            emptyText: "暂无审批记录",
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
