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
    ...(keyword ? { OR: [{ paymentNo: { contains: keyword, mode: "insensitive" } }, { bankRefNo: { contains: keyword, mode: "insensitive" } }] } : {}),
    ...(ownerViaContract(user) as Prisma.PaymentWhereInput),
  };
  const [list, total] = await Promise.all([
    prisma.payment.findMany({ where, orderBy: { receivedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.payment.count({ where })
  ]);
  return { list, total, page, pageSize };
}

export async function getPayment(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.PAYMENT, ACTION.READ);
  const p = await prisma.payment.findFirst({
    where: { id, deletedAt: null, ...(ownerViaContract(user) as Prisma.PaymentWhereInput) },
    include: { allocations: { include: { invoice: { select: { id: true, invoiceNo: true } } } }, invoice: { select: { id: true, invoiceNo: true, amount: true } } }
  });
  if (!p) throw new ApiError(ERROR_CODES.NOT_FOUND, "回款不存在", 404);
  // 详情展示需要:发票编号(从 invoice 嵌套拍平)、项目编号/名称(PaymentAllocation 无 project 关系,用 projectId 反查)
  // TODO(数据模型):在 schema 给 PaymentAllocation 加 project 关系,可让 include 一把出
  for (const a of p.allocations) {
    if (a.invoice?.invoiceNo) {
      (a as unknown as { invoiceNo?: string | null }).invoiceNo = a.invoice.invoiceNo;
    }
  }
  const projectIds = Array.from(
    new Set(p.allocations.map((a) => a.projectId).filter((x): x is string => Boolean(x)))
  );
  if (projectIds.length > 0) {
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, projectNo: true, name: true }
    });
    const byId = new Map(projects.map((x) => [x.id, x]));
    for (const a of p.allocations) {
      if (a.projectId && byId.has(a.projectId)) {
        const proj = byId.get(a.projectId)!;
        (a as unknown as { projectNo?: string; projectName?: string }).projectNo = proj.projectNo;
        (a as unknown as { projectNo?: string; projectName?: string }).projectName = proj.name;
      }
    }
  }
  return p;
}

export async function createPayment(user: SessionUser, input: PaymentCreateInput) {
  requirePermission(user.roleCode, RESOURCE.PAYMENT, ACTION.CREATE);
  return prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findFirst({
      where: { id: input.contractId, deletedAt: null, ...ownerEq(user) }
    });
    if (!contract) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
    if (input.invoiceId) {
      const inv = await tx.invoice.findFirst({ where: { id: input.invoiceId, deletedAt: null } });
      if (!inv || inv.contractId !== input.contractId) throw new ApiError(ERROR_CODES.NOT_FOUND, "发票不属于该合同", 404);
    }
    const paymentNo = await nextBusinessNo("PAYMENT");
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
      // R-10
      const dup = await tx.payment.findFirst({ where: { bankRefNo: ref, NOT: { id: p.id } } });
      if (dup) throw new ApiError(ERROR_CODES.PAYMENT_DUPLICATE_REF, `流水号 ${ref} 已存在`, 409);
      // R-11（若挂发票）
      if (p.invoiceId) {
        const inv = await tx.invoice.findUniqueOrThrow({ where: { id: p.invoiceId } });
        const sum = await tx.payment.aggregate({
          where: { invoiceId: p.invoiceId, status: { in: ["CONFIRMED", "RECONCILED"] }, NOT: { id: p.id } },
          _sum: { amount: true }
        });
        if (Number(sum._sum.amount ?? 0) + Number(p.amount) > Number(inv.amount) + 0.01) {
          throw new ApiError(ERROR_CODES.PAYMENT_OVER_INVOICE, "该发票累计回款将超过发票金额", 422);
        }
      }
      // R-12
      const sumC = await tx.payment.aggregate({
        where: { contractId: p.contractId, status: { in: ["CONFIRMED", "RECONCILED"] }, NOT: { id: p.id } },
        _sum: { amount: true }
      });
      const contract = await tx.contract.findUniqueOrThrow({ where: { id: p.contractId } });
      if (Number(sumC._sum.amount ?? 0) + Number(p.amount) > Number(contract.totalAmount) + 0.01) {
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
      // 创建负数退款记录
      const refund = await tx.payment.create({
        data: {
          paymentNo: `${p.paymentNo}-R${Date.now().toString().slice(-4)}`,
          customerId: p.customerId,
          contractId: p.contractId,
          invoiceId: p.invoiceId,
          amount: -Number(p.amount),
          receivedAt: new Date(),
          method: p.method,
          status: "REFUNDED",
          recorderUserId: user.id,
          reconcileUserId: user.id,
          reconciledAt: new Date(),
          remark: `退款：${input.reason ?? ""}`,
          createdById: user.id,
          updatedById: user.id
        }
      });
      await audit(tx, { actorId: user.id, action: "PAYMENT_REFUND", entity: "Payment", entityId: id, before: { status: p.status }, after: { status: "REFUNDED" } });
      return refund;
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

    if (input.action === "allocate") {
      // 对账后(RECONCILED)及终态(REFUNDED/CANCELLED)锁定分配,避免事后篡改
      if (!["PLANNED", "CONFIRMED"].includes(p.status)) {
        throw new ApiError(
          ERROR_CODES.ENTITY_IMMUTABLE,
          `当前状态 ${p.status} 不允许修改分配明细(仅 PLANNED / CONFIRMED 可重分配)`,
          403
        );
      }
      if (!input.allocations || input.allocations.length === 0) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "请提供分配明细", 400);
      }
      const totalAlloc = input.allocations.reduce((s, a) => s + a.amount, 0);
      const totalAllocDec = new Prisma.Decimal(totalAlloc.toString());
      const paymentAmtDec = new Prisma.Decimal(p.amount.toString());
      if (!totalAllocDec.equals(paymentAmtDec)) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `分配合计 ¥${totalAlloc} 与回款金额 ¥${p.amount} 不一致`, 400);
      }
      await tx.paymentAllocation.deleteMany({ where: { paymentId: id } });
      for (const a of input.allocations) {
        await tx.paymentAllocation.create({
          data: { paymentId: id, invoiceId: a.invoiceId ?? null, projectId: a.projectId ?? null, amount: a.amount }
        });
      }
      return tx.payment.findUniqueOrThrow({ where: { id }, include: { allocations: true } });
    }

    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未知动作", 400);
  });
}
