import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { InvoiceCreateInput, InvoiceUpdateInput, InvoiceActionInput } from "@/lib/validators/invoice";
import { Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { ownerEq, ownerViaContract, parseStatusList } from "@/lib/ownership";
// 把前端传的 attachment 快照(id+name+...)用 DB 真实记录重写一遍,防 spoofing
// 同时支持"新建 invoice 时把已上传到 tmp 的附件绑到新 invoice"
async function resolveInvoiceAttachmentSnapshots(
  raw: { id: string; name: string; url?: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string }[],
  invoiceId: string,
  tx: Prisma.TransactionClient
): Promise<Prisma.InputJsonValue> {
  if (raw.length === 0) return [] as unknown as Prisma.InputJsonValue;
  if (raw.length > 5) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "附件最多 5 个", 400);
  }
  // 老系统迁移数据: id 以 legacy- 开头, 仅作为历史元数据展示, 实际对象不在 Attachment 表
  // 直接原样保留, 不走 DB 校验 / 绑定流程
  const LEGACY_PREFIX = "legacy-";
  const legacyEntries = raw.filter((r) => r.id.startsWith(LEGACY_PREFIX));
  const realEntries = raw.filter((r) => !r.id.startsWith(LEGACY_PREFIX));

  const resolvedFromDb: Array<{ id: string; name: string; mimeType: string; size: number; uploadedBy: string; uploadedAt: string; url?: string }> = [];
  if (realEntries.length > 0) {
    const ids = [...new Set(realEntries.map((r) => r.id))];
    const found = await tx.attachment.findMany({
      where: { id: { in: ids }, deletedAt: null },
      select: { id: true, originalName: true, mimeType: true, size: true, uploadedById: true, uploadedAt: true, invoiceId: true, contractId: true }
    });
    if (found.length !== ids.length) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "附件 id 无效或已删除", 400);
    }
    // 绑定到当前发票:
    //   - 没绑任何东西(presign 时 invoiceId/contractId 都为 null -> 落 tmp):绑定到本 invoice
    //   - 已绑本 invoice:放过
    //   - 已绑别的合同 / 别的发票:拒绝(防越权)
    const toBind = found.filter((a) => !a.invoiceId && !a.contractId);
    if (toBind.length > 0) {
      await tx.attachment.updateMany({
        where: { id: { in: toBind.map((a) => a.id) }, invoiceId: null, contractId: null },
        data: { invoiceId }
      });
    }
    // 已绑本 invoice:放过;已绑其它 invoice 或 任意 contract:拒绝
    const others = found.filter((a) =>
      (a.invoiceId && a.invoiceId !== invoiceId) || a.contractId
    );
    if (others.length > 0) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "部分附件已绑定到其它合同/发票", 403);
    }
    resolvedFromDb.push(...found.map((a) => ({
      id: a.id,
      name: a.originalName,
      mimeType: a.mimeType,
      size: a.size,
      uploadedBy: a.uploadedById,
      uploadedAt: a.uploadedAt.toISOString()
    })));
  }

  // 保持原顺序: legacy 在它被提交的位置原样保留
  const byId = new Map<string, Prisma.InputJsonValue>();
  for (const e of legacyEntries) byId.set(e.id, e as unknown as Prisma.InputJsonValue);
  for (const e of resolvedFromDb) byId.set((e as { id: string }).id, e);
  return raw.map((r) => byId.get(r.id) as { id: string; name?: string; mimeType?: string; size?: number; uploadedBy?: string; uploadedAt?: string; url?: string }) as unknown as Prisma.InputJsonValue;
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
  const statusList = parseStatusList(status);
  const where: Prisma.InvoiceWhereInput = {
    deletedAt: null,
    ...(statusList ? { status: { in: statusList } } : {}),
    ...(contractId ? { contractId } : {}),
    ...(keyword ? { OR: [{ invoiceNo: { contains: keyword, mode: "insensitive" } }, { customerName: { contains: keyword, mode: "insensitive" } }] } : {}),
    ...(ownerViaContract(user) as Prisma.InvoiceWhereInput),
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
    where: { id, deletedAt: null, ...(ownerViaContract(user) as Prisma.InvoiceWhereInput) }
  });
  if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不存在", 404);
  return inv;
}

export async function createInvoice(user: SessionUser, input: InvoiceCreateInput) {
  requirePermission(user.roleCode, RESOURCE.INVOICE, ACTION.CREATE);
  return prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findFirst({
      where: { id: input.contractId, deletedAt: null, ...ownerEq(user) }
    });
    if (!contract) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
    if (contract.status !== "EFFECTIVE" && contract.status !== "EXECUTING") {
      throw new ApiError(
        ERROR_CODES.CONTRACT_STATUS_INVALID,
        `合同 ${contract.contractNo} 当前状态 ${contract.status}，不可开票（须 EFFECTIVE / EXECUTING）`,
        422
      );
    }
    // R-08：累计开票不能超合同总额 (P2-1: 与 R-11/R-12 一致, 加 0.01 元容差)
    const issued = await tx.invoice.aggregate({
      where: { contractId: contract.id, status: "ISSUED", deletedAt: null },
      _sum: { amount: true }
    });
    // 用 Prisma.Decimal 比较，避免 JS number 浮点失真
    const issuedAmt = new Prisma.Decimal(issued._sum.amount?.toString() ?? "0");
    const contractTotal = new Prisma.Decimal(contract.totalAmount.toString());
    const TOL = new Prisma.Decimal("0.01");
    if (issuedAmt.plus(input.amount.toString()).greaterThan(contractTotal.plus(TOL))) {
      throw new ApiError(
        ERROR_CODES.INVOICE_OVER_LIMIT,
        `已开票 ¥${issuedAmt.toFixed(2)}，本次 ¥${input.amount.toFixed(2)}，将超过合同总额 ¥${contract.totalAmount}`,
        422
      );
    }
    // 发票号唯一性预校验:DB 也有 @unique,但提前抛错返回更明确的 422 信息
    const existingNo = await tx.invoice.findFirst({
      where: { invoiceNo: input.invoiceNo, deletedAt: null }
    });
    if (existingNo) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `发票号 ${input.invoiceNo} 已被使用`, 422);
    }
    const { taxAmount, amountExcludingTax } = calcTotals(input.amount, input.taxRate);
    const invoice = await tx.invoice.create({
      data: {
        invoiceNo: input.invoiceNo,
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
        attachments: [] as unknown as Prisma.InputJsonValue,
        status: "DRAFT",
        applicantUserId: user.id,
        createdById: user.id,
        updatedById: user.id
      }
    });
    // 解析附件并绑定(tmp -> invoiceId),把真实记录写回 JSON 快照
    if ((input.attachments ?? []).length > 0) {
      const attachments = await resolveInvoiceAttachmentSnapshots(input.attachments ?? [], invoice.id, tx);
      await tx.invoice.update({ where: { id: invoice.id }, data: { attachments } });
    }
    return tx.invoice.findUnique({ where: { id: invoice.id } });
  });
}

export async function updateInvoice(user: SessionUser, id: string, input: InvoiceUpdateInput) {
  requirePermission(user.roleCode, RESOURCE.INVOICE, ACTION.UPDATE);
  const inv = await prisma.invoice.findFirst({
    where: { id, deletedAt: null, ...(ownerViaContract(user) as Prisma.InvoiceWhereInput) }
  });
  if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不存在", 404);
  if (inv.status !== "DRAFT") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 DRAFT 可修改", 403);
  let taxAmount = inv.taxAmount;
  let amountExcludingTax = inv.amountExcludingTax;
  const newAmount = input.amount;
  if (newAmount !== undefined || input.taxRate !== undefined) {
    const r = calcTotals(newAmount ?? Number(inv.amount), input.taxRate ?? Number(inv.taxRate));
    taxAmount = new Prisma.Decimal(r.taxAmount);
    amountExcludingTax = new Prisma.Decimal(r.amountExcludingTax);
  }
  return prisma.$transaction(async (tx) => {
    // P1-1: 改 amount 时重新跑 R-08, 防止"DRAFT 100 → 改 1000000 → 提交 → 财务开票"绕过合同总额
    if (newAmount !== undefined) {
      const contract = await tx.contract.findUniqueOrThrow({
        where: { id: inv.contractId },
        select: { totalAmount: true }
      });
      const issued = await tx.invoice.aggregate({
        where: { contractId: inv.contractId, status: "ISSUED", deletedAt: null },
        _sum: { amount: true }
      });
      const issuedAmt = new Prisma.Decimal(issued._sum.amount?.toString() ?? "0");
      const contractTotal = new Prisma.Decimal(contract.totalAmount.toString());
      const TOL = new Prisma.Decimal("0.01");
      if (issuedAmt.plus(newAmount.toString()).greaterThan(contractTotal.plus(TOL))) {
        throw new ApiError(
          ERROR_CODES.INVOICE_OVER_LIMIT,
          `已开票 ¥${issuedAmt.toFixed(2)}，本次 ¥${newAmount.toFixed(2)}，将超过合同总额 ¥${contract.totalAmount}`,
          422
        );
      }
    }
    const attachments = input.attachments
      ? await resolveInvoiceAttachmentSnapshots(input.attachments, id, tx)
      : undefined;
    return tx.invoice.update({
      where: { id },
      data: {
        ...input,
        applyDate: input.applyDate ? new Date(input.applyDate) : undefined,
        expectedIssueDate: input.expectedIssueDate ? new Date(input.expectedIssueDate) : undefined,
        amount: newAmount,
        taxRate: input.taxRate,
        taxAmount,
        amountExcludingTax,
        attachments,
        updatedById: user.id
      }
    });
  });
}

// 状态机：submit / issue / reject / void / red-flush
export async function invoiceAction(user: SessionUser, id: string, input: InvoiceActionInput) {
  requirePermission(user.roleCode, RESOURCE.INVOICE, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findFirst({ where: { id, deletedAt: null, ...(ownerViaContract(user) as Prisma.InvoiceWhereInput) } });
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
      // R-09：电子发票号必须 20 位;财务未填时沿用创建时录入的发票号
      const invoiceNo = input.invoiceNo || inv.invoiceNo;
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
      // P1-3: 作废需填 reason (合规要求), 并把已确认/对账的回款自动翻 REFUNDED
      const reason = (input.reason ?? "").trim();
      if (!reason) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "作废发票需填写原因", 400);
      // 取消 PLANNED Payment
      await tx.payment.updateMany({ where: { invoiceId: id, status: "PLANNED" }, data: { status: "CANCELLED" } });
      // 自动退款: CONFIRMED / RECONCILED → REFUNDED (复用 P1-2 的翻转逻辑, 不再创建负数补偿记录)
      const confirmed = await tx.payment.findMany({
        where: { invoiceId: id, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null }
      });
      for (const cp of confirmed) {
        const cpBefore = { status: cp.status, amount: Number(cp.amount) };
        const cpRemark = `发票作废触发退款：${reason}${cp.remark ? ` | 原备注：${cp.remark}` : ""}`;
        await tx.payment.update({ where: { id: cp.id }, data: { status: "REFUNDED", remark: cpRemark, updatedById: user.id } });
        await audit(tx, {
          actorId: user.id,
          action: "PAYMENT_REFUND",
          entity: "Payment",
          entityId: cp.id,
          before: cpBefore,
          after: { status: "REFUNDED", reason, triggeredBy: "INVOICE_VOID", invoiceId: id }
        });
      }
      const updated = await tx.invoice.update({
        where: { id },
        data: { status: "VOIDED", reviewComment: reason, financeUserId: user.id, reviewedAt: new Date() }
      });
      await audit(tx, {
        actorId: user.id,
        action: "INVOICE_VOID",
        entity: "Invoice",
        entityId: id,
        before: { status: inv.status },
        after: { status: "VOIDED", reason, refundedPaymentCount: confirmed.length }
      });
      return updated;
    }
    if (input.action === "red-flush") {
      if (user.roleCode !== "FINANCE" && user.roleCode !== "ADMIN") throw new ApiError(ERROR_CODES.FORBIDDEN, "仅财务可红冲", 403);
      if (inv.status !== "ISSUED") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 ISSUED 可红冲", 403);
      // P1-3: 红冲需填 reason
      const reason = (input.reason ?? "").trim();
      if (!reason) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "红冲发票需填写原因", 400);
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
          remark: `红冲：${reason}`,
          linkedInvoiceId: inv.id,
          createdById: user.id,
          updatedById: user.id
        }
      });
      // 取消原 PLANNED Payment
      await tx.payment.updateMany({ where: { invoiceId: inv.id, status: "PLANNED" }, data: { status: "CANCELLED" } });
      // P1-3: 自动退款已 CONFIRMED/RECONCILED 的回款
      const confirmed = await tx.payment.findMany({
        where: { invoiceId: inv.id, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null }
      });
      for (const cp of confirmed) {
        const cpBefore = { status: cp.status, amount: Number(cp.amount) };
        const cpRemark = `发票红冲触发退款：${reason}${cp.remark ? ` | 原备注：${cp.remark}` : ""}`;
        await tx.payment.update({ where: { id: cp.id }, data: { status: "REFUNDED", remark: cpRemark, updatedById: user.id } });
        await audit(tx, {
          actorId: user.id,
          action: "PAYMENT_REFUND",
          entity: "Payment",
          entityId: cp.id,
          before: cpBefore,
          after: { status: "REFUNDED", reason, triggeredBy: "INVOICE_RED_FLUSH", invoiceId: inv.id }
        });
      }
      // P2-3: 互指 linkedInvoiceId (设计文档 DESIGN-v3 §5.3 明确要求), 让原票能反查负数记录
      const updated = await tx.invoice.update({
        where: { id: inv.id },
        data: {
          status: "RED_FLUSHED",
          reviewComment: reason,
          financeUserId: user.id,
          reviewedAt: new Date(),
          linkedInvoiceId: negative.id
        }
      });
      await tx.invoiceAuditLog.create({ data: { invoiceId: inv.id, actorId: user.id, action: "RED_FLUSH", comment: `→ ${negative.id}` } });
      await audit(tx, {
        actorId: user.id,
        action: "INVOICE_RED_FLUSH",
        entity: "Invoice",
        entityId: inv.id,
        before: { status: "ISSUED" },
        after: { status: "RED_FLUSHED", negativeId: negative.id, reason, refundedPaymentCount: confirmed.length }
      });
      return { original: updated, redFlush: negative };
    }
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未知动作", 400);
  });
}
