import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type {InvoiceCreateInput, InvoiceUpdateInput} from "@/lib/validators/invoice";
import { Prisma } from "@prisma/client";
import { ownerEq, ownerViaContract, parseStatusList } from "@/lib/ownership";
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
