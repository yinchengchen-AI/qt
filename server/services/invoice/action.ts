import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type {InvoiceActionInput} from "@/lib/validators/invoice";
import { Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { nextBusinessNo } from "@/lib/sequence";

import {ownerViaContract} from "@/lib/ownership";
import { runTransitionInTx } from "@/lib/status-machine";

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
        audit: () => ({ actorId: user.id, action: "INVOICE_SUBMIT", before: { status: "DRAFT" }, after: { status: "PENDING_FINANCE" } }),
        mismatchError: { ...mismatch, message: (_c, to) => `仅 DRAFT 可提交(目标: ${to})` },
      });
      return result.updated;
    }

    if (input.action === "issue") {
      requireFinance();
      const inv = await commonLoad(tx);
      if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不存在", 404);
      // R-09: 电子发票号 20 位 / 公司抬头需税号
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
        data.invoiceNo = input.invoiceNo;
      }
      const before = { status: inv.status, invoiceNo: inv.invoiceNo };
      const result = await runTransitionInTx(tx, {
        entity: "Invoice",
        loadInTx: commonLoad,
        from: ["PENDING_FINANCE"],
        to: "ISSUED",
        extraData: () => data,
        audit: () => ({ actorId: user.id, action: "INVOICE_ISSUE", before, after: { status: "ISSUED", invoiceNo } }),
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
        mismatchError: { ...mismatch, message: (_c, to) => `仅 PENDING_FINANCE 可驳回(目标: ${to})` },
      });
      return result.updated;
    }

    if (input.action === "void") {
      requireFinance();
      const inv = await commonLoad(tx);
      if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不存在", 404);
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
        // 取消 PLANNED Payment
        await tx.payment.updateMany({ where: { invoiceId: id, status: "PLANNED" }, data: { status: "CANCELLED" } });
        // 自动退款: CONFIRMED / RECONCILED → REFUNDED
        const confirmed = await tx.payment.findMany({
          where: { invoiceId: id, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null },
        });
        for (const cp of confirmed) {
          const cpBefore = { status: cp.status, amount: Number(cp.amount) };
          const cpRemark = `发票作废触发退款:${reason}${cp.remark ? ` | 原备注:${cp.remark}` : ""}`;
          await tx.payment.update({ where: { id: cp.id }, data: { status: "REFUNDED", remark: cpRemark, updatedById: user.id } });
          await audit(tx, {
            actorId: user.id,
            action: "PAYMENT_REFUND",
            entity: "Payment",
            entityId: cp.id,
            before: cpBefore,
            after: { status: "REFUNDED", reason, triggeredBy: "INVOICE_VOID", invoiceId: id },
          });
        }
      }
      return result.updated;
    }

    if (input.action === "red-flush") {
      requireFinance();
      const inv = await commonLoad(tx);
      if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不存在", 404);
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
        // 取消原 PLANNED Payment
        await tx.payment.updateMany({ where: { invoiceId: inv.id, status: "PLANNED" }, data: { status: "CANCELLED" } });
        // P1-3: 自动退款已 CONFIRMED/RECONCILED 的回款
        const confirmed = await tx.payment.findMany({
          where: { invoiceId: inv.id, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null },
        });
        for (const cp of confirmed) {
          const cpBefore = { status: cp.status, amount: Number(cp.amount) };
          const cpRemark = `发票红冲触发退款:${reason}${cp.remark ? ` | 原备注:${cp.remark}` : ""}`;
          await tx.payment.update({ where: { id: cp.id }, data: { status: "REFUNDED", remark: cpRemark, updatedById: user.id } });
          await audit(tx, {
            actorId: user.id,
            action: "PAYMENT_REFUND",
            entity: "Payment",
            entityId: cp.id,
            before: cpBefore,
            after: { status: "REFUNDED", reason, triggeredBy: "INVOICE_RED_FLUSH", invoiceId: inv.id },
          });
        }
        // 写 InvoiceAuditLog (设计文档要求的 red-flush 专用审计日志)
        await tx.invoiceAuditLog.create({ data: { invoiceId: inv.id, actorId: user.id, action: "RED_FLUSH", comment: `→ ${negative.id}` } });
      }
      return result.updated ? { original: result.updated, redFlush: negative } : null;
    }

    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未知动作", 400);
  });
}

