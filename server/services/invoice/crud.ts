import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type {InvoiceCreateInput, InvoiceUpdateInput} from "@/lib/validators/invoice";
import { Prisma } from "@prisma/client";
import { assertRecordWritable, parseStatusList } from "@/lib/ownership";
import { calcTaxBreakdown } from "@/lib/money";
import { MONEY_TOLERANCE } from "@/lib/money-tolerance";
import { INVOICE_LIMIT_COUNTED_STATUSES } from "@/lib/invoice-amounts";
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
  };
  const [list, total] = await Promise.all([
    prisma.invoice.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.invoice.count({ where })
  ]);
  return { list, total, page, pageSize };
}


export async function getInvoice(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.INVOICE, ACTION.READ);
  const inv = await prisma.invoice.findFirst({
    where: { id, deletedAt: null },
    include: { contract: { select: { contractNo: true, ownerUserId: true } } }
  });
  if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不存在", 404);
  // 平铺合同编号:Invoice 表只有 contractId,前端编辑页"合同编号"需要 contractNo 展示;
  // 同时带出 contract.ownerUserId,供前端对 SALES/EXPERT 做编辑/提交入口的 owner 判定 (与后端 assertRecordWritable 同口径)
  const { contract, ...rest } = inv;
  return {
    ...rest,
    contractNo: contract.contractNo,
    contract: { contractNo: contract.contractNo, ownerUserId: contract.ownerUserId }
  };
}


export async function createInvoice(user: SessionUser, input: InvoiceCreateInput) {
  requirePermission(user.roleCode, RESOURCE.INVOICE, ACTION.CREATE);
  return prisma.$transaction(async (tx) => {
    // 先锁合同行 (SELECT ... FOR UPDATE 序列化同一合同的并发开票), 消除 R-08 "先 SUM 后 INSERT" 的 TOCTOU 竞态。
    // 用 raw FOR UPDATE 而非 dummy UPDATE, 避免顺带刷新合同 updatedAt 造成污染。
    // 锁行无条件; SALES/EXPERT 只能在自己合同上开票的守门在锁到行后由 assertRecordWritable 显式 403。
    const contracts = await tx.$queryRaw<Array<{
      id: string; contractNo: string; status: string; totalAmount: Prisma.Decimal; customerId: string; customerName: string; ownerUserId: string;
    }>>`
      SELECT id, "contractNo", status, "totalAmount", "customerId", "customerName", "ownerUserId"
      FROM "Contract"
      WHERE id = ${input.contractId} AND "deletedAt" IS NULL
      FOR UPDATE`;
    const contract = contracts[0];
    if (!contract) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
    assertRecordWritable(user, contract.ownerUserId, "发票");
    if (contract.status !== "ACTIVE") {
      throw new ApiError(
        ERROR_CODES.CONTRACT_STATUS_INVALID,
        `合同 ${contract.contractNo} 当前状态 ${contract.status}，不可开票（须 ACTIVE）`,
        422
      );
    }
    // R-08：累计开票不能超合同总额 (P2-1: 与 R-11/R-12 一致, 加 0.01 元容差)
    // R-08 口径含 PENDING_FINANCE (此前漏掉, 发票提交后即"隐身"可无限超额)
    const issued = await tx.invoice.aggregate({
      where: { contractId: contract.id, status: { in: [...INVOICE_LIMIT_COUNTED_STATUSES] }, deletedAt: null },
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
    // 发票号唯一性预校验:DB @unique 覆盖软删行, 预校验同口径查全量 (不带 deletedAt 过滤),
    // 提前抛 422 友好信息, 避免撞库约束变 500
    const existingNo = await tx.invoice.findFirst({
      where: { invoiceNo: input.invoiceNo }
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
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
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
  // 无条件查找: 读放开后越权写必须显式 403 (而非 owner 过滤出 404 掩盖存在性)
  const inv = await prisma.invoice.findFirst({
    where: { id, deletedAt: null },
    include: { contract: { select: { ownerUserId: true } } }
  });
  if (!inv) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不存在", 404);
  // 写守门: SALES/EXPERT 只能改自己合同下的发票 (非受限角色直接放行)
  assertRecordWritable(user, inv.contract?.ownerUserId, "发票");
  // 状态机门控: admin 任意态可改; 非 admin 仅 DRAFT 可改 (与 server/services/contract/crud.ts:248 一致)
  if (user.roleCode !== "ADMIN" && inv.status !== "DRAFT") {
    throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "当前状态不可修改", 403);
  }

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
    const r = calcTaxBreakdown(newAmount ?? inv.amount, newTaxRate ?? inv.taxRate);
    taxAmount = r.taxAmount;
    amountExcludingTax = r.amountExcludingTax;
  }

  return prisma.$transaction(async (tx) => {
    // P1-1: 改 amount 时重新跑 R-08, 防止"DRAFT 100 → 改 1000000 → 提交 → 财务开票"绕过合同总额
    if (newAmount !== undefined) {
      // 先锁合同行 (FOR UPDATE), 与 createInvoice / assertWithinContractLimit 同一序列化点,
      // 消除并发改金额的复检窗口
      const contracts = await tx.$queryRaw<Array<{ totalAmount: Prisma.Decimal }>>`
        SELECT "totalAmount" FROM "Contract" WHERE id = ${inv.contractId} FOR UPDATE`;
      const contract = contracts[0];
      if (!contract) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
      // R-08 口径与 createInvoice 对齐 (含 PENDING_FINANCE), 排除自身
      const issued = await tx.invoice.aggregate({
        where: {
          contractId: inv.contractId,
          status: { in: [...INVOICE_LIMIT_COUNTED_STATUSES] },
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
    let updated;
    try {
      updated = await tx.invoice.update({
        // 状态门控原子化: 事务外 :142 的读只是友好预判, 真正的门控在这里——
        // 非 admin 带 status 条件更新, 并发下 DRAFT→他态后这里撞 P2025
        where: user.roleCode === "ADMIN" ? { id } : { id, status: "DRAFT" },
        data: {
          ...(safeInput as InvoiceUpdateInput),
          applyDate: input.applyDate ? new Date(input.applyDate) : undefined,
          expectedIssueDate: input.expectedIssueDate ? new Date(input.expectedIssueDate) : undefined,
          dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
          amount: newAmount,
          taxRate: newTaxRate,
          taxAmount,
          amountExcludingTax,
          attachments,
          updatedById: user.id
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
        throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "当前状态不可修改", 403);
      }
      throw e;
    }
    if (newAmount !== undefined) {
      // 系统预建 PLANNED 回款 (issue 时按发票全额自动创建, paymentNo 以 -PLANNED 结尾) 是旧金额快照,
      // 改金额后同步; 手工登记的 PLANNED 不动 (用户自己负责)
      await tx.payment.updateMany({
        where: { invoiceId: id, status: "PLANNED", paymentNo: { endsWith: "-PLANNED" }, deletedAt: null },
        data: { amount: newAmount, updatedById: user.id }
      });
    }
    return updated;
  });
}

// 状态机：submit / issue / reject / void / red-flush
// 主体改走 lib/status-machine.ts:runTransitionInTx, 复杂副作用(自动建 PLANNED Payment / 自动退款)
// 在 transition 之后在同一个 tx 内执行. 5 个 arm 的状态迁移分别传 from / to, 状态不匹配保留原
// ENTITY_IMMUTABLE 403 错误码(同原代码).
