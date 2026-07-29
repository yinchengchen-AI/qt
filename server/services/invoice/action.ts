import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type {InvoiceActionInput} from "@/lib/validators/invoice";
import { Prisma } from "@prisma/client";
import { nextBusinessNo } from "@/lib/sequence";
import { audit } from "@/server/audit";

import {ownerViaContract} from "@/lib/ownership";
import { runTransitionInTx } from "@/lib/status-machine";
import { refundPaymentInTx } from "@/server/services/payment";
import { MONEY_TOLERANCE } from "@/lib/money-tolerance";
import { INVOICE_LIMIT_COUNTED_STATUSES } from "@/lib/invoice-amounts";

// R-08 复检 (DESIGN-v3.md:393 要求 submit/issue 环节执行):
// 确认累计开票 (含本票, 本票在 DRAFT/PENDING_FINANCE 口径内) ≤ 合同总额。
// 堵住 "提交后隐身" 与 "并发绕过" 两类超额路径——创建环节的校验在这些场景下不可靠。
async function assertWithinContractLimit(
  tx: Prisma.TransactionClient,
  inv: { id: string; contractId: string }
): Promise<void> {
  // 先锁合同行 (FOR UPDATE), 序列化同一合同的并发 submit/issue 复检——
  // 外层事务默认 ReadCommitted, 只 aggregate 不锁会让两张 DRAFT 并发 submit 双双通过
  const contracts = await tx.$queryRaw<Array<{ totalAmount: Prisma.Decimal; contractNo: string }>>`
    SELECT "totalAmount", "contractNo" FROM "Contract" WHERE id = ${inv.contractId} FOR UPDATE`;
  const contract = contracts[0];
  if (!contract) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
  const issued = await tx.invoice.aggregate({
    where: { contractId: inv.contractId, status: { in: [...INVOICE_LIMIT_COUNTED_STATUSES] }, deletedAt: null },
    _sum: { amount: true }
  });
  const issuedAmt = new Prisma.Decimal(issued._sum.amount?.toString() ?? "0");
  const contractTotal = new Prisma.Decimal(contract.totalAmount.toString());
  // 本票已在口径内, 无需再加; 只校验当前累计未超额
  if (issuedAmt.greaterThan(contractTotal.plus(MONEY_TOLERANCE))) {
    throw new ApiError(
      ERROR_CODES.INVOICE_OVER_LIMIT,
      `累计开票 ¥${issuedAmt.toFixed(2)} 已超过合同总额 ¥${contract.totalAmount}，不可继续`,
      422
    );
  }
}

// 红冲票 (负数票) 判定: amount < 0, 或存在其它发票的 linkedInvoiceId 指向它 (原票红冲后互指)。
// 红冲票不可再作废/再红冲, 否则净额自洽被破坏 (原票 RED_FLUSHED 计 +A、负票 VOIDED 不计 → 虚增)。
async function assertNotRedFlushTicket(
  tx: Prisma.TransactionClient,
  inv: { id: string; amount: Prisma.Decimal },
  verb: string
): Promise<void> {
  const linked = await tx.invoice.findFirst({ where: { linkedInvoiceId: inv.id }, select: { id: true } });
  if (new Prisma.Decimal(inv.amount.toString()).lessThan(0) || linked) {
    throw new ApiError(ERROR_CODES.FORBIDDEN, `红冲票不可${verb}`, 403);
  }
}

// 发票作废/红冲时批量取消该发票的 PLANNED 回款:
// 逐笔写 OperationLog (此前 updateMany 无审计), 并过滤 deletedAt。
async function cancelPlannedPayments(
  tx: Prisma.TransactionClient,
  invoiceId: string,
  actorId: string
): Promise<void> {
  const planned = await tx.payment.findMany({
    where: { invoiceId, status: "PLANNED", deletedAt: null },
    select: { id: true }
  });
  if (planned.length === 0) return;
  await tx.payment.updateMany({
    where: { id: { in: planned.map((p) => p.id) } },
    data: { status: "CANCELLED", updatedById: actorId }
  });
  for (const p of planned) {
    await audit(tx, {
      actorId,
      action: "PAYMENT_CANCEL",
      entity: "Payment",
      entityId: p.id,
      before: { status: "PLANNED" },
      after: { status: "CANCELLED" }
    });
  }
}

export async function invoiceAction(user: SessionUser, id: string, input: InvoiceActionInput) {
  requirePermission(user.roleCode, RESOURCE.INVOICE, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const commonLoad = (t: typeof tx) => t.invoice.findFirst({
      where: { id, deletedAt: null, ...(ownerViaContract(user) as Prisma.InvoiceWhereInput) },
    });
    const requireFinance = () => {
      if (user.roleCode !== "FINANCE" && user.roleCode !== "ADMIN") {
        throw new ApiError(ERROR_CODES.FORBIDDEN, `仅财务可${input.action === "issue" ? "开票" : input.action === "reject" ? "驳回" : input.action === "void" ? "作废" : "红冲"}`, 403);
      }
    };
    const mismatch = { code: ERROR_CODES.ENTITY_IMMUTABLE, status: 403 } as const;

    if (input.action === "submit") {
      const result = await runTransitionInTx(tx, {
        entity: "Invoice",
        loadInTx: commonLoad,
        from: ["DRAFT"],
        to: "PENDING_FINANCE",
        precondition: (current, t) => assertWithinContractLimit(t, current),
        audit: () => ({ actorId: user.id, action: "INVOICE_SUBMIT", before: { status: "DRAFT" }, after: { status: "PENDING_FINANCE" } }),
        mismatchError: { ...mismatch, message: (_c, to) => `仅 DRAFT 可提交(目标: ${to})` },
      });
      return result.updated;
    }

    if (input.action === "issue") {
      requireFinance();
      const inv = await commonLoad(tx);
      if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不存在", 404);
      // R-09: 电子发票号 20 位
      const invoiceNo = input.invoiceNo || inv.invoiceNo;
      if ((inv.invoiceType === "VAT_ELECTRONIC" || inv.invoiceType === "ELEC_NORMAL") && !/^\d{20}$/.test(invoiceNo)) {
        throw new ApiError(ERROR_CODES.INVOICE_INFO_INVALID, "电子发票号必须 20 位数字", 422);
      }

      const data: Record<string, unknown> = {
        actualIssueDate: input.actualIssueDate ? new Date(input.actualIssueDate) : new Date(),
        financeUserId: user.id,
        reviewComment: input.reason ?? null,
      };
      if (input.invoiceNo && input.invoiceNo !== inv.invoiceNo) {
        // 改票号前做唯一性预校验 (排除自身); DB @unique 覆盖软删行, 同口径查全量
        const dup = await tx.invoice.findFirst({ where: { invoiceNo: input.invoiceNo, NOT: { id: inv.id } } });
        if (dup) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `发票号 ${input.invoiceNo} 已被使用`, 422);
        data.invoiceNo = input.invoiceNo;
      }
      const before = { status: inv.status, invoiceNo: inv.invoiceNo };
      const result = await runTransitionInTx(tx, {
        entity: "Invoice",
        loadInTx: commonLoad,
        from: ["PENDING_FINANCE"],
        to: "ISSUED",
        precondition: (current, t) => assertWithinContractLimit(t, current),
        extraData: () => data,
        audit: () => ({ actorId: user.id, action: "INVOICE_ISSUE", before, after: { status: "ISSUED", invoiceNo } }),
        // 站内信通知申请人: 发票已开具
        event: async (current) => ({
          type: "INVOICE_ISSUED",
          payload: { invoiceId: current.id, invoiceNo, amount: Number(current.amount) },
          receivers: [current.applicantUserId],
        }),
        mismatchError: { ...mismatch, message: (_c, to) => `仅 PENDING_FINANCE 可开票(目标: ${to})` },
      });
      if (result.result === "DONE") {
        // 预创建 PLANNED Payment
        await tx.payment.create({
          data: {
            paymentNo: `${await nextBusinessNo("PAYMENT")}-PLANNED`,
            customerId: inv.customerId,
            contractId: inv.contractId,
            invoiceId: inv.id,
            amount: inv.amount,
            receivedAt: new Date(),
            method: "BANK_TRANSFER",
            status: "PLANNED",
            recorderUserId: user.id,
            remark: `开票预创建（发票 ${invoiceNo}）`,
            createdById: user.id,
            updatedById: user.id,
          },
        });
      }
      return result.updated;
    }

    if (input.action === "reject") {
      requireFinance();
      const result = await runTransitionInTx(tx, {
        entity: "Invoice",
        loadInTx: commonLoad,
        from: ["PENDING_FINANCE"],
        to: "REJECTED",
        extraData: () => ({ financeUserId: user.id, reviewComment: input.reason ?? null }),
        audit: () => ({ actorId: user.id, action: "INVOICE_REJECT", before: { status: "PENDING_FINANCE" }, after: { status: "REJECTED" } }),
        // 站内信通知申请人: 发票被驳回 (含原因)
        event: async (current) => ({
          type: "INVOICE_REJECTED",
          payload: { invoiceId: current.id, invoiceNo: current.invoiceNo, reason: input.reason ?? null },
          receivers: [current.applicantUserId],
        }),
        mismatchError: { ...mismatch, message: (_c, to) => `仅 PENDING_FINANCE 可驳回(目标: ${to})` },
      });
      return result.updated;
    }

    if (input.action === "void") {
      requireFinance();
      const inv = await commonLoad(tx);
      if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不存在", 404);
      await assertNotRedFlushTicket(tx, inv, "作废");
      const today = new Date();
      const issueDate = inv.actualIssueDate ?? today;
      if (today.getTime() - new Date(issueDate).getTime() > 24 * 60 * 60 * 1000) {
        throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "已超过当日,不可作废;请走红冲", 403);
      }
      // P1-3: 作废需填 reason (合规要求)
      const reason = (input.reason ?? "").trim();
      if (!reason) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "作废发票需填写原因", 400);
      const result = await runTransitionInTx(tx, {
        entity: "Invoice",
        loadInTx: commonLoad,
        from: ["ISSUED"],
        to: "VOIDED",
        extraData: () => ({ reviewComment: reason, financeUserId: user.id }),
        audit: () => ({ actorId: user.id, action: "INVOICE_VOID", before: { status: "ISSUED" }, after: { status: "VOIDED", reason } }),
        mismatchError: { ...mismatch, message: (_c, to) => `仅 ISSUED 可作废(目标: ${to})` },
      });
      if (result.result === "DONE") {
        // 取消 PLANNED Payment (逐笔审计)
        await cancelPlannedPayments(tx, id, user.id);
        // 自动退款: CONFIRMED / RECONCILED → REFUNDED
        const confirmed = await tx.payment.findMany({
          where: { invoiceId: id, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null },
        });
        for (const cp of confirmed) {
          await refundPaymentInTx(tx, cp, user.id, reason, "发票作废触发退款");
        }
      }
      return result.updated;
    }

    if (input.action === "red-flush") {
      requireFinance();
      const inv = await commonLoad(tx);
      if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不存在", 404);
      await assertNotRedFlushTicket(tx, inv, "再红冲");
      // P1-3: 红冲需填 reason
      const reason = (input.reason ?? "").trim();
      if (!reason) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "红冲发票需填写原因", 400);
      // 先建负数记录 (与原代码一致: redFlush 必须在 update 前创建, 以便 linkedInvoiceId 互指)
      const negative = await tx.invoice.create({
        data: {
          invoiceNo: `RED-${inv.invoiceNo}-${Date.now()}`,
          contractId: inv.contractId,
          customerId: inv.customerId,
          customerName: inv.customerName,
          invoiceType: inv.invoiceType,
          amount: new Prisma.Decimal(inv.amount).negated(),
          taxRate: inv.taxRate,
          taxAmount: new Prisma.Decimal(inv.taxAmount).negated(),
          amountExcludingTax: new Prisma.Decimal(inv.amountExcludingTax).negated(),
          applyDate: new Date(),
          actualIssueDate: new Date(),
          titleType: inv.titleType,
          titleName: inv.titleName,
          taxNo: inv.taxNo,
          bankName: inv.bankName,
          bankAccount: inv.bankAccount,
          address: inv.address,
          phone: inv.phone,
          status: "ISSUED",
          applicantUserId: user.id,
          financeUserId: user.id,
          remark: `红冲:${reason}`,
          linkedInvoiceId: inv.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      const result = await runTransitionInTx(tx, {
        entity: "Invoice",
        loadInTx: commonLoad,
        from: ["ISSUED"],
        to: "RED_FLUSHED",
        extraData: () => ({ reviewComment: reason, financeUserId: user.id, linkedInvoiceId: negative.id }),
        audit: () => ({ actorId: user.id, action: "INVOICE_RED_FLUSH", before: { status: "ISSUED" }, after: { status: "RED_FLUSHED", negativeId: negative.id, reason } }),
        mismatchError: { ...mismatch, message: (_c, to) => `仅 ISSUED 可红冲(目标: ${to})` },
      });
      if (result.result === "DONE") {
        // 取消原 PLANNED Payment (逐笔审计)
        await cancelPlannedPayments(tx, inv.id, user.id);
        // P1-3: 自动退款已 CONFIRMED/RECONCILED 的回款
        const confirmed = await tx.payment.findMany({
          where: { invoiceId: inv.id, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null },
        });
        for (const cp of confirmed) {
          await refundPaymentInTx(tx, cp, user.id, reason, "发票红冲触发退款");
        }
        // 写 InvoiceAuditLog (设计文档要求的 red-flush 专用审计日志)
        await tx.invoiceAuditLog.create({ data: { invoiceId: inv.id, actorId: user.id, action: "RED_FLUSH", comment: `→ ${negative.id}` } });
      }
      return result.updated ? { original: result.updated, redFlush: negative } : null;
    }

    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未知动作", 400);
  });
}

