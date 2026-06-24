import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { InvoiceCreateInput, InvoiceUpdateInput, InvoiceActionInput } from "@/lib/validators/invoice";
import { Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { ownerEq, ownerViaContract, parseStatusList } from "@/lib/ownership";
import { runTransitionInTx } from "@/lib/status-machine";
import { calcTaxBreakdown } from "@/lib/money";
import { MONEY_TOLERANCE } from "@/lib/money-tolerance";
import { resolveAttachmentSnapshots } from "@/lib/attachment-snapshot";
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
    if (contract.status !== "ACTIVE") {
      throw new ApiError(
        ERROR_CODES.CONTRACT_STATUS_INVALID,
        `合同 ${contract.contractNo} 当前状态 ${contract.status}，不可开票（须 ACTIVE）`,
        422
      );
    }
    // R-08：累计开票不能超合同总额 (P2-1: 与 R-11/R-12 一致, 加 0.01 元容差)
    // R-08: 累计开票 = DRAFT + ISSUED + RED_FLUSHED (负数自然抵扣), VOIDED 不算 (已作废)
    // 包含 DRAFT 是为了避免业务可以无限制创建草稿, 实际开票时才发现超额
    const issued = await tx.invoice.aggregate({
      where: { contractId: contract.id, status: { in: ["DRAFT", "ISSUED", "RED_FLUSHED"] }, deletedAt: null },
      _sum: { amount: true }
    });
    // 用 Prisma.Decimal 比较，避免 JS number 浮点失真
    const issuedAmt = new Prisma.Decimal(issued._sum.amount?.toString() ?? "0");
    const contractTotal = new Prisma.Decimal(contract.totalAmount.toString());
    const TOL = MONEY_TOLERANCE;
    if (issuedAmt.plus(input.amount.toString()).greaterThan(contractTotal.plus(TOL))) {
      throw new ApiError(
        ERROR_CODES.INVOICE_OVER_LIMIT,
        `累计开票 ¥${issuedAmt.toFixed(2)}，本次 ¥${input.amount.toFixed(2)}，将超过合同总额 ¥${contract.totalAmount}`,
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
    const { taxAmount, amountExcludingTax } = calcTaxBreakdown(input.amount, input.taxRate);
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
    // 解析附件: 内部已把临时附件 updateMany 绑到 invoiceId (Attachment.invoiceId 关系)
    // 同时把真实记录写回 JSON 快照, 详情页直接读 invoice.attachments
    const attachments = await resolveAttachmentSnapshots(input.attachments ?? [], "Invoice", invoice.id, tx);
    if ((input.attachments ?? []).length > 0) {
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

  // 防御: 即使 schema 允许 partial(), service 层也显式丢弃不可更新字段, 防止 spread 时写进 DB
  const safeInput = { ...input } as Record<string, unknown>;
  delete safeInput.contractId;
  delete safeInput.invoiceNo;
  delete safeInput.status;
  delete safeInput.customerId;
  delete safeInput.customerName;
  delete safeInput.applicantUserId;
  delete safeInput.createdById;
  delete safeInput.updatedById;

  let taxAmount = inv.taxAmount;
  let amountExcludingTax = inv.amountExcludingTax;
  const newAmount = safeInput.amount as number | undefined;
  const newTaxRate = safeInput.taxRate as number | undefined;
  if (newAmount !== undefined || newTaxRate !== undefined) {
    const r = calcTaxBreakdown(newAmount ?? Number(inv.amount), newTaxRate ?? Number(inv.taxRate));
    taxAmount = r.taxAmount;
    amountExcludingTax = r.amountExcludingTax;
  }

  return prisma.$transaction(async (tx) => {
    // P1-1: 改 amount 时重新跑 R-08, 防止"DRAFT 100 → 改 1000000 → 提交 → 财务开票"绕过合同总额
    if (newAmount !== undefined) {
      const contract = await tx.contract.findUniqueOrThrow({
        where: { id: inv.contractId },
        select: { totalAmount: true }
      });
      // R-08 口径与 createInvoice 对齐: DRAFT + ISSUED + RED_FLUSHED, 排除自身
      const issued = await tx.invoice.aggregate({
        where: {
          contractId: inv.contractId,
          status: { in: ["DRAFT", "ISSUED", "RED_FLUSHED"] },
          deletedAt: null,
          NOT: { id }
        },
        _sum: { amount: true }
      });
      const issuedAmt = new Prisma.Decimal(issued._sum.amount?.toString() ?? "0");
      const contractTotal = new Prisma.Decimal(contract.totalAmount.toString());
      const TOL = MONEY_TOLERANCE;
      if (issuedAmt.plus(newAmount.toString()).greaterThan(contractTotal.plus(TOL))) {
        throw new ApiError(
          ERROR_CODES.INVOICE_OVER_LIMIT,
          `已开票/草稿 ¥${issuedAmt.toFixed(2)}，本次 ¥${newAmount.toFixed(2)}，将超过合同总额 ¥${contract.totalAmount}`,
          422
        );
      }
    }
    const attachments = input.attachments
      ? await resolveAttachmentSnapshots(input.attachments, "Invoice", id, tx)
      : undefined;
    return tx.invoice.update({
      where: { id },
      data: {
        ...(safeInput as InvoiceUpdateInput),
        applyDate: input.applyDate ? new Date(input.applyDate) : undefined,
        expectedIssueDate: input.expectedIssueDate ? new Date(input.expectedIssueDate) : undefined,
        amount: newAmount,
        taxRate: newTaxRate,
        taxAmount,
        amountExcludingTax,
        attachments,
        updatedById: user.id
      }
    });
  });
}

// 状态机：submit / issue / reject / void / red-flush
// 主体改走 lib/status-machine.ts:runTransitionInTx, 复杂副作用(自动建 PLANNED Payment / 自动退款)
// 在 transition 之后在同一个 tx 内执行. 5 个 arm 的状态迁移分别传 from / to, 状态不匹配保留原
// ENTITY_IMMUTABLE 403 错误码(同原代码).
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
      if (inv.titleType === "COMPANY" && !inv.taxNo) {
        throw new ApiError(ERROR_CODES.INVOICE_INFO_INVALID, "公司抬头需填写税号", 422);
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
