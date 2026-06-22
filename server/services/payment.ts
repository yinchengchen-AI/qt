import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { nextBusinessNo } from "@/lib/sequence";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { PaymentCreateInput, PaymentActionInput } from "@/lib/validators/payment";
import { Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { emit, listAdminUserIds } from "@/server/events/bus";
import { ownerEq, ownerViaContract, parseStatusList } from "@/lib/ownership";

export async function listPayments(
  user: SessionUser,
  params: { page: number; pageSize: number; keyword?: string; status?: string; contractId?: string; invoiceId?: string }
) {
  requirePermission(user.roleCode, RESOURCE.PAYMENT, ACTION.READ);
  const { page, pageSize, keyword, status, contractId, invoiceId } = params;
  const statusList = parseStatusList(status);
  const where: Prisma.PaymentWhereInput = {
    deletedAt: null,
    ...(statusList ? { status: { in: statusList } } : {}),
    ...(contractId ? { contractId } : {}),
    ...(invoiceId ? { invoiceId } : {}),
    ...(keyword
      ? {
          // 关键字命中:回款号 / 银行流水号 / 客户名称;
          // customer 用 Prisma 关系过滤 (payment.customerId -> customer.name),
          // 一并排除软删客户避免历史脏数据. 这样查询是单 SQL,不走 N+1 反查.
          OR: [
            { paymentNo: { contains: keyword, mode: "insensitive" } },
            { bankRefNo: { contains: keyword, mode: "insensitive" } },
            { customer: { name: { contains: keyword, mode: "insensitive" }, deletedAt: null } }
          ]
        }
      : {}),
    ...(ownerViaContract(user) as Prisma.PaymentWhereInput),
  };
  const [list, total] = await Promise.all([
    // 关联合同只带出"上下文字段"(合同号/标题/客户/服务类型/金额), 列表"合同"列渲染用;
    // 不带 deliverables — 交付物仅在合同管理侧展示, 回款不掺杂该业务.
    prisma.payment.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, paymentNo: true, customerId: true, contractId: true, invoiceId: true,
        amount: true, receivedAt: true, method: true, bankRefNo: true, bankName: true,
        remark: true, status: true, recorderUserId: true, reconcileUserId: true,
        reconciledAt: true, createdAt: true, updatedAt: true, createdById: true,
        updatedById: true, deletedAt: true,
        contract: { select: { contractNo: true, title: true, customerName: true, serviceType: true, totalAmount: true } }
      }
    }),
    prisma.payment.count({ where })
  ]);
  return { list, total, page, pageSize };
}

export async function getPayment(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.PAYMENT, ACTION.READ);
  const p = await prisma.payment.findFirst({
    where: { id, deletedAt: null, ...(ownerViaContract(user) as Prisma.PaymentWhereInput) },
    include: {
      invoice: { select: { id: true, invoiceNo: true, amount: true } },
      // 合同上下文(合同号/标题/客户/服务类型/金额), 详情页"关联合同"卡展示用;
      // 不带 deliverables — 交付物属于合同管理范畴, 不在回款侧展示
      contract: { select: { contractNo: true, title: true, customerName: true, serviceType: true, totalAmount: true, status: true, paymentMethod: true, signDate: true } }
    }
  });
  if (!p) throw new ApiError(ERROR_CODES.NOT_FOUND, "回款不存在", 404);
  return p;
}

export async function createPayment(user: SessionUser, input: PaymentCreateInput) {
  requirePermission(user.roleCode, RESOURCE.PAYMENT, ACTION.CREATE);
  return prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findFirst({
      where: { id: input.contractId, deletedAt: null, ...ownerEq(user) }
    });
    if (!contract) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
    if (contract.status !== "ACTIVE") {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `合同 ${contract.contractNo} 当前状态 ${contract.status}，不可登记回款（须 ACTIVE）`, 422);
    }
    let inv: Awaited<ReturnType<typeof tx.invoice.findFirst>> = null;
    if (input.invoiceId) {
      inv = await tx.invoice.findFirst({ where: { id: input.invoiceId, deletedAt: null } });
      if (!inv || inv.contractId !== input.contractId) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不属于该合同", 404);
      }
      if (inv.status !== "ISSUED") {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "仅已开票（ISSUED）状态的发票可关联回款", 422);
      }
    }
    const paymentNo = await nextBusinessNo("PAYMENT");
    // 登记阶段即做金额前置校验, 避免"登记通过、确认时才报超额"
    const TOL = new Prisma.Decimal("0.01");
    const inputAmt = new Prisma.Decimal(input.amount.toString());
    if (input.invoiceId && inv) {
      const sum = await tx.payment.aggregate({
        where: { invoiceId: inv.id, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null },
        _sum: { amount: true }
      });
      const sumAmt = new Prisma.Decimal(sum._sum.amount?.toString() ?? "0");
      const invAmt = new Prisma.Decimal(inv.amount.toString());
      if (sumAmt.plus(inputAmt).greaterThan(invAmt.plus(TOL))) {
        throw new ApiError(ERROR_CODES.PAYMENT_OVER_INVOICE, "该发票累计回款将超过发票金额", 422);
      }
    }
    const sumC = await tx.payment.aggregate({
      where: { contractId: contract.id, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null },
      _sum: { amount: true }
    });
    const sumCAmt = new Prisma.Decimal(sumC._sum.amount?.toString() ?? "0");
    const contractAmt = new Prisma.Decimal(contract.totalAmount.toString());
    if (sumCAmt.plus(inputAmt).greaterThan(contractAmt.plus(TOL))) {
      throw new ApiError(ERROR_CODES.PAYMENT_OVER_CONTRACT, "该合同累计回款将超过合同总额", 422);
    }
    return tx.payment.create({
      data: {
        paymentNo,
        customerId: contract.customerId,
        contractId: input.contractId,
        invoiceId: input.invoiceId ?? null,
        amount: input.amount,
        receivedAt: new Date(input.receivedAt),
        method: input.method,
        bankRefNo: input.bankRefNo ?? null,
        bankName: input.bankName ?? null,
        remark: input.remark ?? null,
        status: "PLANNED",
        recorderUserId: user.id,
        createdById: user.id,
        updatedById: user.id
      }
    });
  });
}

export async function paymentAction(user: SessionUser, id: string, input: PaymentActionInput) {
  requirePermission(user.roleCode, RESOURCE.PAYMENT, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const p = await tx.payment.findFirst({ where: { id, deletedAt: null, ...(ownerViaContract(user) as Prisma.PaymentWhereInput) } });
    if (!p) throw new ApiError(ERROR_CODES.NOT_FOUND, "回款不存在", 404);

    if (input.action === "confirm") {
      if (user.roleCode !== "FINANCE" && user.roleCode !== "ADMIN") throw new ApiError(ERROR_CODES.FORBIDDEN, "仅财务可确认", 403);
      if (p.status !== "PLANNED") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 PLANNED 可确认", 403);
      const ref = input.bankRefNo ?? p.bankRefNo;
      if (!ref) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "请填写银行流水号", 400);
      // R-10 (P1-4: 与 schema 注释"PLANNED 允许重复"一致, 仅在已生效的记录里去重)
      const dup = await tx.payment.findFirst({
        where: { bankRefNo: ref, status: { in: ["CONFIRMED", "RECONCILED"] }, NOT: { id: p.id } }
      });
      if (dup) throw new ApiError(ERROR_CODES.PAYMENT_DUPLICATE_REF, `流水号 ${ref} 已存在`, 409);
      // R-11（若挂发票）: Decimal 累加 + 0.01 容差
      const TOL = new Prisma.Decimal("0.01");
      if (p.invoiceId) {
        const inv = await tx.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
        const sum = await tx.payment.aggregate({
          where: { invoiceId: p.invoiceId, status: { in: ["CONFIRMED", "RECONCILED"] }, NOT: { id: p.id } },
          _sum: { amount: true }
        });
        const sumAmt = new Prisma.Decimal(sum._sum.amount?.toString() ?? "0");
        const invAmt = new Prisma.Decimal(inv.amount.toString());
        if (sumAmt.plus(p.amount.toString()).greaterThan(invAmt.plus(TOL))) {
          throw new ApiError(ERROR_CODES.PAYMENT_OVER_INVOICE, "该发票累计回款将超过发票金额", 422);
        }
      }
      // R-12: 合同累计, 同样 Decimal + 0.01 容差
      const sumC = await tx.payment.aggregate({
        where: { contractId: p.contractId, status: { in: ["CONFIRMED", "RECONCILED"] }, NOT: { id: p.id } },
        _sum: { amount: true }
      });
      const contract = await tx.contract.findUniqueOrThrow({ where: { id: p.contractId } });
      const sumCAmt = new Prisma.Decimal(sumC._sum.amount?.toString() ?? "0");
      const contractAmt = new Prisma.Decimal(contract.totalAmount.toString());
      if (sumCAmt.plus(p.amount.toString()).greaterThan(contractAmt.plus(TOL))) {
        throw new ApiError(ERROR_CODES.PAYMENT_OVER_CONTRACT, "该合同累计回款将超过合同总额", 422);
      }
      const before = { status: p.status, bankRefNo: p.bankRefNo };
      const updated = await tx.payment.update({ where: { id }, data: { status: "CONFIRMED", bankRefNo: ref } });
      await audit(tx, { actorId: user.id, action: "PAYMENT_CONFIRM", entity: "Payment", entityId: id, before, after: { status: "CONFIRMED", bankRefNo: ref } });
      // 通知 contract owner + admins
      const ct = await tx.contract.findUniqueOrThrow({ where: { id: p.contractId }, select: { ownerUserId: true } });
      const admins = await listAdminUserIds(tx);
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: p.customerId }, select: { name: true } });
      await emit(tx, {
        type: "PAYMENT_RECEIVED",
        payload: { paymentId: id, paymentNo: p.paymentNo, amount: Number(p.amount), customerName: customer.name },
        receivers: Array.from(new Set([ct.ownerUserId, ...admins]))
      });
      return updated;
    }

    if (input.action === "reconcile") {
      if (user.roleCode !== "FINANCE" && user.roleCode !== "ADMIN") throw new ApiError(ERROR_CODES.FORBIDDEN, "仅财务可对账", 403);
      if (p.status !== "CONFIRMED") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 CONFIRMED 可对账", 403);
      const before = { status: p.status };
      const updated = await tx.payment.update({ where: { id }, data: { status: "RECONCILED", reconcileUserId: user.id, reconciledAt: new Date() } });
      await audit(tx, { actorId: user.id, action: "PAYMENT_RECONCILE", entity: "Payment", entityId: id, before, after: { status: "RECONCILED" } });
      return updated;
    }

    if (input.action === "refund") {
      if (user.roleCode !== "FINANCE" && user.roleCode !== "ADMIN") throw new ApiError(ERROR_CODES.FORBIDDEN, "仅财务可退款", 403);
      if (!["CONFIRMED", "RECONCILED"].includes(p.status)) throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "当前状态不可退款", 403);
      const reason = (input.reason ?? "").trim();
      if (!reason) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "退款需填写原因", 400);
      // P1-2: 把原 payment 翻为 REFUNDED, 累计和 (R-11/R-12) 自动从 CONFIRMED/RECONCILED 池里掉出来;
      // 不再创建负数补偿记录 (避免双记风险)
      const newRemark = `退款：${reason}${p.remark ? ` | 原备注：${p.remark}` : ""}`;
      const before = { status: p.status, amount: Number(p.amount) };
      const updated = await tx.payment.update({
        where: { id },
        data: { status: "REFUNDED", remark: newRemark, updatedById: user.id }
      });
      await audit(tx, {
        actorId: user.id,
        action: "PAYMENT_REFUND",
        entity: "Payment",
        entityId: id,
        before,
        after: { status: "REFUNDED", reason }
      });
      return updated;
    }

    if (input.action === "cancel") {
      if (p.status !== "PLANNED") throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "仅 PLANNED 可取消", 403);
      if (p.recorderUserId !== user.id && user.roleCode !== "ADMIN" && user.roleCode !== "FINANCE") {
        throw new ApiError(ERROR_CODES.FORBIDDEN, "仅创建人或财务可取消", 403);
      }
      const before = { status: p.status };
      const updated = await tx.payment.update({ where: { id }, data: { status: "CANCELLED" } });
      await audit(tx, { actorId: user.id, action: "PAYMENT_CANCEL", entity: "Payment", entityId: id, before, after: { status: "CANCELLED" } });
      return updated;
    }

    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未知动作", 400);
  });
}
