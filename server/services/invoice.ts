import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { requireSession, type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { InvoiceCreateInput, InvoiceUpdateInput, InvoiceActionInput } from "@/lib/validators/invoice";
import { Prisma } from "@prisma/client";
import { audit } from "@/server/audit";

// SALES 行级隔离：发票所属合同的 ownerUserId 必须 = 自己
function invoiceSalesIsolation(user: SessionUser): Prisma.InvoiceWhereInput {
  if (user.roleCode === "SALES") {
    return { contract: { ownerUserId: user.id } };
  }
  return {};
}

function calcTotals(amount: number, taxRate: number) {
  const taxAmount = round2((amount * taxRate) / (1 + taxRate));
  const amountExcludingTax = round2(amount - taxAmount);
  return { taxAmount, amountExcludingTax };
}
function round2(v: number) { return Math.round(v * 100) / 100; }

export async function listInvoices(
  user: SessionUser,
  params: { page: number; pageSize: number; keyword?: string; status?: string; contractId?: string }
) {
  requirePermission(user.roleCode, RESOURCE.INVOICE, ACTION.READ);
  const { page, pageSize, keyword, status, contractId } = params;
  const where: Prisma.InvoiceWhereInput = {
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(contractId ? { contractId } : {}),
    ...(keyword ? { OR: [{ invoiceNo: { contains: keyword, mode: "insensitive" } }, { customerName: { contains: keyword, mode: "insensitive" } }] } : {}),
    ...(user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {})
  };
  const [list, total] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.invoice.count({ where })
  ]);
  return { list, total, page, pageSize };
}

export async function getInvoice(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.INVOICE, ACTION.READ);
  const inv = await prisma.invoice.findFirst({
    where: { id, deletedAt: null, ...(user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {}) }
  });
  if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不存在", 404);
  return inv;
}

export async function createInvoice(user: SessionUser, input: InvoiceCreateInput) {
  requirePermission(user.roleCode, RESOURCE.INVOICE, ACTION.CREATE);
  return prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findFirst({
      where: { id: input.contractId, deletedAt: null, ...(user.roleCode === "SALES" ? { ownerUserId: user.id } : {}) }
    });
    if (!contract) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
    if (contract.status !== "EFFECTIVE" && contract.status !== "EXECUTING") {
      throw new ApiError(
        ERROR_CODES.CONTRACT_STATUS_INVALID,
        `合同 ${contract.contractNo} 当前状态 ${contract.status}，不可开票（须 EFFECTIVE / EXECUTING）`,
        422
      );
    }
    // R-08：累计开票不能超合同总额
    const issued = await tx.invoice.aggregate({
      where: { contractId: contract.id, status: "ISSUED", deletedAt: null },
      _sum: { amount: true }
    });
    // 用 Prisma.Decimal 比较，避免 JS number 浮点失真
    const issuedAmt = new Prisma.Decimal(issued._sum.amount?.toString() ?? "0");
    const contractTotal = new Prisma.Decimal(contract.totalAmount.toString());
    if (issuedAmt.plus(input.amount).greaterThan(contractTotal)) {
      throw new ApiError(
        ERROR_CODES.INVOICE_OVER_LIMIT,
        `已开票 ¥${issuedAmt.toFixed(2)}，本次 ¥${input.amount.toFixed(2)}，将超过合同总额 ¥${contract.totalAmount}`,
        422
      );
    }
    const { taxAmount, amountExcludingTax } = calcTotals(input.amount, input.taxRate);
    return tx.invoice.create({
      data: {
        invoiceNo: `DRAFT-${Date.now()}`,
        contractId: contract.id,
        customerId: contract.customerId,
        customerName: contract.customerName,
        invoiceType: input.invoiceType,
        amount: input.amount,
        taxRate: input.taxRate,
        taxAmount,
        amountExcludingTax,
        applyDate: new Date(input.applyDate),
        expectedIssueDate: input.expectedIssueDate ? new Date(input.expectedIssueDate) : null,
        titleType: input.titleType,
        titleName: input.titleName,
        taxNo: input.taxNo ?? null,
        bankName: input.bankName ?? null,
        bankAccount: input.bankAccount ?? null,
        address: input.address ?? null,
        phone: input.phone ?? null,
        remark: input.remark ?? null,
        status: "DRAFT",
        applicantUserId: user.id,
        createdById: user.id,
        updatedById: user.id
      }
    });
  });
}

export async function updateInvoice(user: SessionUser, id: string, input: InvoiceUpdateInput) {
  requirePermission(user.roleCode, RESOURCE.INVOICE, ACTION.UPDATE);
  const inv = await prisma.invoice.findFirst({
    where: { id, deletedAt: null, ...(user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {}) }
  });
  if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不存在", 404);
  if (inv.status !== "DRAFT") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 DRAFT 可修改", 403);
  let taxAmount = inv.taxAmount;
  let amountExcludingTax = inv.amountExcludingTax;
  if (input.amount !== undefined || input.taxRate !== undefined) {
    const r = calcTotals(input.amount ?? Number(inv.amount), input.taxRate ?? Number(inv.taxRate));
    taxAmount = r.taxAmount as any;
    amountExcludingTax = r.amountExcludingTax as any;
  }
  return prisma.invoice.update({
    where: { id },
    data: {
      ...input,
      applyDate: input.applyDate ? new Date(input.applyDate) : undefined,
      expectedIssueDate: input.expectedIssueDate ? new Date(input.expectedIssueDate) : undefined,
      amount: input.amount,
      taxRate: input.taxRate,
      taxAmount,
      amountExcludingTax,
      updatedById: user.id
    }
  });
}

// 状态机：submit / issue / reject / void / red-flush
export async function invoiceAction(user: SessionUser, id: string, input: InvoiceActionInput) {
  requirePermission(user.roleCode, RESOURCE.INVOICE, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id, deletedAt: null, ...invoiceSalesIsolation(user) } });
    if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不存在", 404);
    if (input.action === "submit") {
      if (inv.status !== "DRAFT") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 DRAFT 可提交", 403);
      const updated = await tx.invoice.update({ where: { id }, data: { status: "PENDING_FINANCE" } });
      await audit(tx, { actorId: user.id, action: "INVOICE_SUBMIT", entity: "Invoice", entityId: id, before: { status: inv.status }, after: { status: "PENDING_FINANCE" } });
      return updated;
    }
    if (input.action === "issue") {
      if (user.roleCode !== "FINANCE" && user.roleCode !== "ADMIN") throw new ApiError(ERROR_CODES.FORBIDDEN, "仅财务可开票", 403);
      if (inv.status !== "PENDING_FINANCE") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 PENDING_FINANCE 可开票", 403);
      // R-09：电子发票号必须 20 位
      const invoiceNo = input.invoiceNo ?? inv.invoiceNo;
      if (inv.invoiceType === "VAT_ELECTRONIC" || inv.invoiceType === "ELEC_NORMAL") {
        if (!/^\d{20}$/.test(invoiceNo)) throw new ApiError(ERROR_CODES.INVOICE_INFO_INVALID, "电子发票号必须 20 位数字", 422);
      }
      if (inv.titleType === "COMPANY" && !inv.taxNo) {
        throw new ApiError(ERROR_CODES.INVOICE_INFO_INVALID, "公司抬头需填写税号", 422);
      }
      // 预创建 PLANNED Payment
      const before = { status: inv.status, invoiceNo: inv.invoiceNo };
      const updated = await tx.invoice.update({
        where: { id },
        data: {
          status: "ISSUED",
          invoiceNo,
          actualIssueDate: input.actualIssueDate ? new Date(input.actualIssueDate) : new Date(),
          financeUserId: user.id,
          reviewedAt: new Date(),
          reviewComment: input.reason ?? null
        }
      });
      await audit(tx, { actorId: user.id, action: "INVOICE_ISSUE", entity: "Invoice", entityId: id, before, after: { status: "ISSUED", invoiceNo } });
      await tx.payment.create({
        data: {
          paymentNo: `PLANNED-${Date.now()}-${id.slice(-4)}`,
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
          updatedById: user.id
        }
      });
      return updated;
    }
    if (input.action === "reject") {
      if (user.roleCode !== "FINANCE" && user.roleCode !== "ADMIN") throw new ApiError(ERROR_CODES.FORBIDDEN, "仅财务可驳回", 403);
      if (inv.status !== "PENDING_FINANCE") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 PENDING_FINANCE 可驳回", 403);
      const updated = await tx.invoice.update({ where: { id }, data: { status: "REJECTED", reviewedAt: new Date(), financeUserId: user.id, reviewComment: input.reason ?? null } });
      await audit(tx, { actorId: user.id, action: "INVOICE_REJECT", entity: "Invoice", entityId: id, before: { status: inv.status }, after: { status: "REJECTED" } });
      return updated;
    }
    if (input.action === "void") {
      if (user.roleCode !== "FINANCE" && user.roleCode !== "ADMIN") throw new ApiError(ERROR_CODES.FORBIDDEN, "仅财务可作废", 403);
      if (inv.status !== "ISSUED") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 ISSUED 可作废", 403);
      const today = new Date();
      const issueDate = inv.actualIssueDate ?? today;
      if (today.getTime() - new Date(issueDate).getTime() > 24 * 60 * 60 * 1000) {
        throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "已超过当日，不可作废；请走红冲", 403);
      }
      // 取消 PLANNED Payment
      await tx.payment.updateMany({ where: { invoiceId: id, status: "PLANNED" }, data: { status: "CANCELLED" } });
      const updated = await tx.invoice.update({ where: { id }, data: { status: "VOIDED" } });
      await audit(tx, { actorId: user.id, action: "INVOICE_VOID", entity: "Invoice", entityId: id, before: { status: inv.status }, after: { status: "VOIDED" } });
      return updated;
    }
    if (input.action === "red-flush") {
      if (user.roleCode !== "FINANCE" && user.roleCode !== "ADMIN") throw new ApiError(ERROR_CODES.FORBIDDEN, "仅财务可红冲", 403);
      if (inv.status !== "ISSUED") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 ISSUED 可红冲", 403);
      // 生成负数记录
      const negative = await tx.invoice.create({
        data: {
          invoiceNo: `RED-${inv.invoiceNo}-${Date.now()}`,
          contractId: inv.contractId,
          customerId: inv.customerId,
          customerName: inv.customerName,
          invoiceType: inv.invoiceType,
          amount: -Number(inv.amount),
          taxRate: inv.taxRate,
          taxAmount: -Number(inv.taxAmount),
          amountExcludingTax: -Number(inv.amountExcludingTax),
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
          reviewedAt: new Date(),
          remark: `红冲：${input.reason ?? ""}`,
          linkedInvoiceId: inv.id,
          createdById: user.id,
          updatedById: user.id
        }
      });
      // 取消原 PLANNED Payment
      await tx.payment.updateMany({ where: { invoiceId: inv.id, status: "PLANNED" }, data: { status: "CANCELLED" } });
      const updated = await tx.invoice.update({ where: { id: inv.id }, data: { status: "RED_FLUSHED" } });
      await tx.invoiceAuditLog.create({ data: { invoiceId: inv.id, actorId: user.id, action: "RED_FLUSH", comment: `→ ${negative.id}` } });
      await audit(tx, { actorId: user.id, action: "INVOICE_RED_FLUSH", entity: "Invoice", entityId: inv.id, before: { status: "ISSUED" }, after: { status: "RED_FLUSHED", negativeId: negative.id } });
      return { original: updated, redFlush: negative };
    }
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未知动作", 400);
  });
}
