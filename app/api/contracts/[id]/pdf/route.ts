// 合同详情 → 打印页 HTML
import { err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { getContract, getContractOverview } from "@/server/services/contract";
import { prisma } from "@/lib/prisma";
import { renderPrintHtml, type PrintDoc } from "@/lib/print-html";
import {
  PAYMENT_METHOD_MAP,
  SERVICE_TYPE_MAP,
  CONTRACT_STATUS_MAP,
  PROJECT_STATUS_MAP,
  REVIEW_ACTION_MAP,
  INVOICE_STATUS_MAP,
  PAYMENT_STATUS_MAP,
} from "@/lib/enum-maps";

const fmtDate = (s: string | Date | null | undefined) =>
  s ? new Date(s).toLocaleDateString("zh-CN") : "—";
const fmtDateTime = (s: string | Date | null | undefined) =>
  s ? new Date(s).toLocaleString("zh-CN") : "—";
const fmtAmount = (v: string | number | null | undefined) =>
  v == null || v === "" ? "—" : "¥" + Number(v).toFixed(2);

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
          {
            label: "业务员:",
            value: owner ? `${owner.name}(${owner.employeeNo})` : "—",
          },
          {
            label: "签订人:",
            value: c.signerId
              ? signer
                ? `${signer.name}(${signer.employeeNo})`
                : "—"
              : "—",
          },
        ],
        mainRows: [
          { label: "合同标题", value: c.title },
          { label: "客户", value: c.customerName },
          {
            label: "服务类型",
            value: SERVICE_TYPE_MAP[c.serviceType] ?? c.serviceType,
          },
          {
            label: "签订人",
            value: signer ? `${signer.name}(${signer.employeeNo})` : "—",
          },
          { label: "签订日", value: fmtDate(c.signDate) },
          { label: "服务起期", value: fmtDate(c.startDate) },
          { label: "服务止期", value: fmtDate(c.endDate) },
          { label: "含税总额", value: fmtAmount(Number(c.totalAmount)) },
          { label: "税率", value: (Number(c.taxRate) * 100).toFixed(2) + "%" },
          { label: "税额", value: fmtAmount(Number(c.taxAmount)) },
          {
            label: "不含税金额",
            value: fmtAmount(Number(c.amountExcludingTax)),
          },
          {
            label: "付款方式",
            value: PAYMENT_METHOD_MAP[c.paymentMethod] ?? c.paymentMethod,
          },
          { label: "状态", value: CONTRACT_STATUS_MAP[c.status] ?? c.status },
          {
            label: "审批人",
            value: reviewer
              ? `${reviewer.name}(${reviewer.employeeNo})`
              : (c.reviewerId ?? "—"),
          },
          {
            label: "审批时间",
            value: c.reviewAt ? fmtDateTime(c.reviewAt) : "—",
          },
          { label: "审批意见", value: c.reviewComment ?? "—" },
          { label: "合同备注", value: c.remark ?? "—" },
        ],
        summary: [
          {
            label: "含税总额",
            value: fmtAmount(Number(c.totalAmount)),
            tone: "primary",
          },
          {
            label: "已开票",
            value: fmtAmount(t.invoicedAmount),
            tone: "warning",
          },
          {
            label: "未开票",
            value: fmtAmount(remainingInvoice),
            tone: "danger",
          },
          { label: "已回款", value: fmtAmount(t.paidAmount), tone: "success" },
          {
            label: "未回款",
            value: fmtAmount(remainingPayment),
            tone: "danger",
          },
        ],
        sections: [
          {
            title: "拆分项目",
            columns: [
              "项目编号",
              "项目名称",
              "起期",
              "止期",
              "工作流完成度",
              "状态",
            ],
            rows: overview.projects.map((p) => {
              const completed = p.workflowCompleted;
              const total = p.workflowTaskCount;
              const pct =
                total > 0 ? ((completed / total) * 100).toFixed(1) + "%" : "—";
              return {
                项目编号: p.projectNo,
                项目名称: p.name,
                起期: fmtDate(p.startDate),
                止期: fmtDate(p.endDate),
                工作流完成度: pct,
                状态: PROJECT_STATUS_MAP[p.status] ?? p.status,
              };
            }),
            emptyText: "暂无拆分项目",
          },
          {
            title: "开票记录",
            columns: ["发票号", "申请日", "开票日", "金额", "状态"],
            rows: overview.invoices.map((i) => ({
              发票号: i.invoiceNo ?? "未开",
              申请日: fmtDate(i.applyDate),
              开票日: fmtDate(i.actualIssueDate),
              金额: fmtAmount(i.amount),
              状态: INVOICE_STATUS_MAP[i.status] ?? i.status,
            })),
            emptyText: "暂无开票记录",
          },
          {
            title: "回款记录",
            columns: ["回单号", "到账日", "金额", "状态"],
            rows: overview.payments.map((p) => ({
              回单号: p.paymentNo,
              到账日: fmtDate(p.receiveDate),
              金额: fmtAmount(p.amount),
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
              上传时间: fmtDateTime(a.uploadedAt),
            })),
            emptyText: "暂无附件",
          },
          {
            title: "审批记录",
            rows:
              c.reviewLogs && c.reviewLogs.length
                ? c.reviewLogs.map((l) => ({
                    label: fmtDateTime(l.at),
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
