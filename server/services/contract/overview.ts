import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";

import { INVOICE_ISSUED_AMOUNT_STATUSES } from "@/lib/invoice-amounts";
import { isNoInvoiceOverdue, isInvoicePaymentGap } from "@/server/services/contract/linkage-checks";
import { getBillingStatus, getPaymentStatus } from "@/lib/contract-billing";
import type { BillingStatus, PaymentProgressStatus } from "@/types/enums";
import { Prisma } from "@prisma/client";

export type ContractOverview = {
  // 合同交付物清单(从 Contract.deliverables 透出)
  deliverables: Array<{
    id: string;
    name: string;
    type?: string;
    dueDate?: string;
    quantity?: number;
    unit?: string;
    remark?: string;
  }>;
  invoices: Array<{
    id: string;
    invoiceNo: string;
    status: string;
    amount: string;
    applyDate: string;
    actualIssueDate: string | null;
  }>;
  payments: Array<{
    id: string;
    paymentNo: string;
    status: string;
    amount: string;
    receiveDate: string;
  }>;
  reviewLogs: Array<{
    id: string;
    action: string;
    reviewerId: string;
    comment: string | null;
    at: string;
  }>;
  // 联动补盲预警 (Phase 3, 与 daily-linkage-check job 同源判定, 防口径漂移)
  warnings: {
    /** 生效 30 天无已开票发票 */
    noInvoice: boolean;
    /** 已开票>=1万 且回款缺口>20% 且最新发票开具超 30 天 */
    invoicePaymentGap: boolean;
  };
  // 续签链 (Phase 1.5): 本合同续签自哪个合同 / 被哪些合同续签
  renewedFrom: { id: string; contractNo: string; status: string } | null;
  renewals: Array<{ id: string; contractNo: string; status: string }>;
  // 合同交付物附件清单 (扁平列表; 已软删的附件不出现)
  // 来自合同详情"交付物"tab 的上传, 写权限仅 admin / 签订人 / 负责人
  deliverableAttachments: Array<{
    id: string;
    name: string;
    mimeType: string;
    size: number;
    uploadedBy: string;
    uploadedAt: string;
  }>;
  totals: {
    invoiceCount: number;
    paymentCount: number;
    totalAmount: number;
    invoicedAmount: number;
    paidAmount: number;
    billingStatus: BillingStatus;
    paymentStatus: PaymentProgressStatus;
  };
};


export async function getContractOverview(
  user: SessionUser,
  contractId: string
): Promise<ContractOverview> {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.READ);
  const c = await prisma.contract.findFirst({ where: { id: contractId, deletedAt: null } });
  if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);

  const [invoices, payments, reviewLogs, deliverableAttachments, renewedFrom, renewals] = await Promise.all([
    prisma.invoice.findMany({
      where: { contractId, deletedAt: null },
      orderBy: { applyDate: "desc" }
    }),
    prisma.payment.findMany({
      where: { contractId, deletedAt: null },
      orderBy: { receivedAt: "desc" }
    }),
    prisma.contractReviewLog.findMany({
      where: { contractId },
      orderBy: { at: "desc" },
      take: 50
    }),
    // 交付物附件: contractId 过滤 + 软删过滤 + 仅 isDeliverable=true
    prisma.attachment.findMany({
      where: { contractId, deletedAt: null, isDeliverable: true },
      orderBy: { uploadedAt: "desc" }
    }),
    // 续签链: 源合同 (若本合同是续签) + 续签本合同的合同列表
    c.renewedFromId
      ? prisma.contract.findFirst({
          where: { id: c.renewedFromId, deletedAt: null },
          select: { id: true, contractNo: true, status: true }
        })
      : Promise.resolve(null),
    prisma.contract.findMany({
      where: { renewedFromId: contractId, deletedAt: null },
      select: { id: true, contractNo: true, status: true },
      orderBy: { createdAt: "desc" }
    })
  ]);

  // 总数(与 server/services/statistics.ts:18-30 语义一致):
  //   invoicedAmount = sum(Invoice.amount)  where status IN (ISSUED,RED_FLUSHED)  (红冲对 +A/−A 净 0)
  //   paidAmount     = sum(Payment.amount)  where status IN (CONFIRMED,RECONCILED)
  // 累加走 Prisma.Decimal 再转 number, 避免 JS number 浮点漂移 (与项目金额口径一致)
  let invoicedAmount = new Prisma.Decimal(0);
  for (const inv of invoices) if ((INVOICE_ISSUED_AMOUNT_STATUSES as readonly string[]).includes(inv.status)) invoicedAmount = invoicedAmount.plus(inv.amount.toString());
  let paidAmount = new Prisma.Decimal(0);
  for (const p of payments) if (p.status === "CONFIRMED" || p.status === "RECONCILED") paidAmount = paidAmount.plus(p.amount.toString());

  // 联动预警判定 (与 daily-linkage-check job 同源): 最新已开票发票的开具日
  const issuedInvoices = invoices.filter((i) =>
    (INVOICE_ISSUED_AMOUNT_STATUSES as readonly string[]).includes(i.status)
  );
  const latestInvoiceDate = issuedInvoices.reduce<Date | null>(
    (max, i) => (i.actualIssueDate && (!max || i.actualIssueDate > max) ? i.actualIssueDate : max),
    null
  );
  const warnings = {
    noInvoice: isNoInvoiceOverdue({ status: c.status, startDate: c.startDate }, issuedInvoices.length > 0, new Date()),
    invoicePaymentGap: isInvoicePaymentGap({
      status: c.status,
      invoicedAmount,
      paidAmount,
      latestInvoiceDate
    }, new Date())
  };

  // 交付物附件扁平列表 (按 uploadedAt 倒序)
  const deliverableAttachmentList: Array<{ id: string; name: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string }> = deliverableAttachments.map((a) => ({
    id: a.id,
    name: a.originalName,
    mimeType: a.mimeType,
    size: a.size,
    uploadedBy: a.uploadedById,
    uploadedAt: a.uploadedAt.toISOString()
  }));

  return {
    // 合同交付物清单透出; DB null 时回退空数组, 详情页 + 回款关联展示都用得到
    // 合同结构化交付物清单 (JSON) 已下线, 改为详情 tab 内上传实际交付文件
    deliverables: [],
    deliverableAttachments: deliverableAttachmentList,
    invoices: invoices.map((i) => ({
      id: i.id,
      invoiceNo: i.invoiceNo,
      status: i.status,
      amount: i.amount.toString(),
      applyDate: i.applyDate.toISOString(),
      actualIssueDate: i.actualIssueDate ? i.actualIssueDate.toISOString() : null
    })),
    payments: payments.map((p) => ({
      id: p.id,
      paymentNo: p.paymentNo,
      status: p.status,
      amount: p.amount.toString(),
      receiveDate: p.receivedAt.toISOString()
    })),
    reviewLogs: reviewLogs.map((r) => ({
      id: r.id,
      action: r.action,
      reviewerId: r.reviewerId,
      comment: r.comment,
      at: r.at.toISOString()
    })),
    warnings,
    renewedFrom: renewedFrom ?? null,
    renewals: renewals.map((r) => ({ id: r.id, contractNo: r.contractNo, status: r.status })),
    totals: {
      invoiceCount: invoices.length,
      paymentCount: payments.length,
      totalAmount: Number(c.totalAmount),
      invoicedAmount: invoicedAmount.toNumber(),
      paidAmount: paidAmount.toNumber(),
      billingStatus: getBillingStatus(invoicedAmount.toNumber(), Number(c.totalAmount)),
      paymentStatus: getPaymentStatus(paidAmount.toNumber(), Number(c.totalAmount))
    }
  };
}

/**
 * 软删除合同（仅 admin 可调用）。
 * 约束:
 *   - admin 任意状态可删; 实际能否删除由子数据兜底 (发票/回款/附件)
 *   - 不能存在未删除的子发票 / 回款 / 附件
 *   - 事务内写 deletedAt + audit log
 *
 * 隔离级别 + P2034 重试由 lib/soft-delete.ts 统一提供.
 */
