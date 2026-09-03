import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { nextBusinessNo } from "@/lib/sequence";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { PaymentCreateInput, PaymentActionInput } from "@/lib/validators/payment";
import { Prisma } from "@prisma/client";
import type { Prisma as PrismaNS } from "@prisma/client";
import { listAdminUserIds } from "@/server/events/bus";
import { assertRecordWritable, ownerViaContract, parseStatusList } from "@/lib/ownership";
import { runTransitionInTx } from "@/lib/status-machine";
import { flushPendingKicks } from "@/server/notifications/hub";
import { MONEY_TOLERANCE } from "@/lib/money-tolerance";

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
    // 读放开: SALES/EXPERT 全量可读 (role-browse-permissions); 行级 owner 过滤仅统计/工作台口径使用
  };
  const [list, total] = await Promise.all([
    // 关联合同只带出"上下文字段"(合同号/标题/客户/服务类型/金额), 列表"合同"列渲染用;
    // 不带 deliverables — 交付物仅在合同管理侧展示, 回款不掺杂该业务.
    prisma.payment.findMany({
      where,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, paymentNo: true, customerId: true, contractId: true, invoiceId: true,
        amount: true, receivedAt: true, method: true, bankRefNo: true, bankName: true,
        remark: true, status: true, recorderUserId: true, reconcileUserId: true,
        reconciledAt: true, createdAt: true, updatedAt: true, createdById: true,
        updatedById: true, deletedAt: true,
        contract: { select: { contractNo: true, title: true, customerName: true, serviceType: true, totalAmount: true } },
        // 导出 Excel"关联发票号"列用; 列表页 UI 不消费该字段
        invoice: { select: { invoiceNo: true } }
      }
    }),
    prisma.payment.count({ where })
  ]);
  return { list, total, page, pageSize };
}

export async function getPayment(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.PAYMENT, ACTION.READ);
  const p = await prisma.payment.findFirst({
    where: { id, deletedAt: null },
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

export async function createPayment(
  user: SessionUser,
  input: PaymentCreateInput,
  options?: { force?: boolean; forceReason?: string },
) {
  requirePermission(user.roleCode, RESOURCE.PAYMENT, ACTION.CREATE);
  // admin force 旁路: 仅 ADMIN 可用, 用于 CLOSED 合同上补录回款
  // (典型场景: cron 误关 / admin 误关后, 重开+补录两步走)
  if (options?.force && user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可强制录回款（force）", 403);
  }
  if (options?.force === true && !options.forceReason?.trim()) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "force 模式下必须填写 forceReason 说明", 400);
  }

  return prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findFirst({
      where: { id: input.contractId, deletedAt: null }
    });
    if (!contract) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
    // 写守门: SALES/EXPERT 只能在自己名下的合同登记回款 (读放开后由显式断言替代行过滤)
    assertRecordWritable(user, contract.ownerUserId, "回款");
    if (contract.status !== "ACTIVE") {
      // 旁路: admin + force + CLOSED 合同允许登记回款
      // (其它状态如 DRAFT 不允许, 防止误操作)
      const canBypass =
        options?.force === true &&
        user.roleCode === "ADMIN" &&
        contract.status === "CLOSED";
      if (!canBypass) {
        throw new ApiError(
          ERROR_CODES.VALIDATION_FAILED,
          `合同 ${contract.contractNo} 当前状态 ${contract.status}，不可登记回款（须 ACTIVE${options?.force ? "，或 admin force + CLOSED" : ""}）`,
          422,
        );
      }
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
    const paymentNo = await nextBusinessNo("PAYMENT", undefined, tx);
    // 登记阶段即做金额前置校验, 避免"登记通过、确认时才报超额"
    // 即使 force 模式也校验: 防止 force 旁路下被滥用为超额录入
    const TOL = MONEY_TOLERANCE;
    const inputAmt = new Prisma.Decimal(input.amount.toString());
    if (input.invoiceId && inv) {
      const sum = await tx.payment.aggregate({
        where: {
          invoiceId: inv.id,
          deletedAt: null,
          OR: [
            { status: { in: ["CONFIRMED", "RECONCILED"] } },
            // 手工登记的 PLANNED 也计入预检, 防止同发票堆积多笔待确认回款;
            // 排除 paymentNo 以 -PLANNED 结尾的系统预建记录(开票时自动创建, 金额=发票全额),
            // 否则已有自动预建记录的发票将完全无法手工登记(死锁)
            { status: "PLANNED", paymentNo: { not: { endsWith: "-PLANNED" } } }
          ]
        },
        _sum: { amount: true }
      });
      const sumAmt = new Prisma.Decimal(sum._sum.amount?.toString() ?? "0");
      const invAmt = new Prisma.Decimal(inv.amount.toString());
      if (sumAmt.plus(inputAmt).greaterThan(invAmt.plus(TOL))) {
        throw new ApiError(ERROR_CODES.PAYMENT_OVER_INVOICE, "该发票累计回款将超过发票金额（已存在待确认回款，请先确认或取消）", 422);
      }
    }
    const sumC = await tx.payment.aggregate({
      where: {
        contractId: contract.id,
        deletedAt: null,
        OR: [
          { status: { in: ["CONFIRMED", "RECONCILED"] } },
          // 同上: 手工 PLANNED 计入, 系统预建(-PLANNED 后缀)不计
          { status: "PLANNED", paymentNo: { not: { endsWith: "-PLANNED" } } }
        ]
      },
      _sum: { amount: true }
    });
    const sumCAmt = new Prisma.Decimal(sumC._sum.amount?.toString() ?? "0");
    const contractAmt = new Prisma.Decimal(contract.totalAmount.toString());
    if (sumCAmt.plus(inputAmt).greaterThan(contractAmt.plus(TOL))) {
      throw new ApiError(ERROR_CODES.PAYMENT_OVER_CONTRACT, "该合同累计回款将超过合同总额（已存在待确认回款，请先确认或取消）", 422);
    }
    // force 模式下追加审计标记到 remark, 方便后续筛查所有 force 录入的回款
    const baseRemark = input.remark ?? "";
    const finalRemark =
      options?.force === true
        ? `[FORCE_BACKFILL:${options.forceReason?.trim().slice(0, 200) ?? "n/a"}] ${baseRemark}`.trim()
        : baseRemark || null;
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
        remark: finalRemark,
        status: "PLANNED",
        recorderUserId: user.id,
        createdById: user.id,
        updatedById: user.id
      }
    });
  }).then((r) => {
    flushPendingKicks();
    return r;
  });
}

// 在事务内将一笔 Payment 从 CONFIRMED/RECONCILED 退到 REFUNDED,
// 统一走 lib/status-machine.ts 状态机框架。
// 供 paymentAction.refund 与 invoiceAction(void/red-flush) 复用。
export async function refundPaymentInTx(
  tx: PrismaNS.TransactionClient,
  payment: { id: string; status: string; amount: Prisma.Decimal; remark: string | null },
  userId: string,
  reason: string,
  remarkPrefix = "退款",
): Promise<Record<string, unknown>> {
  const result = await runTransitionInTx(tx, {
    entity: "Payment",
    loadInTx: (t) => t.payment.findFirst({
      where: { id: payment.id, deletedAt: null },
      select: { id: true, status: true, amount: true, remark: true, contractId: true, invoiceId: true, paymentNo: true, customerId: true },
    }),
    from: ["CONFIRMED", "RECONCILED"],
    to: "REFUNDED",
    extraData: (current) => ({
      remark: `${remarkPrefix}:${reason}${current.remark ? ` | 原备注:${current.remark}` : ""}`,
      updatedById: userId,
    }),
    audit: (current) => ({
      actorId: userId,
      action: "PAYMENT_REFUND",
      before: { status: current.status, amount: Number(current.amount) },
      after: { status: "REFUNDED", reason },
    }),
    mismatchError: { code: ERROR_CODES.ENTITY_IMMUTABLE, status: 403, message: (_c, to) => `当前状态不可退款(目标: ${to})` },
  });
  if (!result.updated) throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "退款状态迁移失败", 403);
  return result.updated;
}

// 状态机：confirm / reconcile / refund / cancel
// 主体改走 lib/status-machine.ts:runTransitionInTx, 4 个 arm 共用 mismatchError 覆写
// ENTITY_IMMUTABLE 403, 角色校验 (FINANCE/ADMIN) 留在 caller.
export async function paymentAction(user: SessionUser, id: string, input: PaymentActionInput): Promise<Record<string, unknown>> {
  // 权限按动作分流: cancel 只需 CREATE (SALES/EXPERT 有, 修复其无法取消自己登记的 PLANNED),
  // 能否取消仍由下方 precondition 限定"创建人本人或 ADMIN/FINANCE";
  // confirm/reconcile/refund 需 UPDATE (FINANCE/ADMIN), 且有 requireFinance 门控
  if (input.action === "cancel") {
    requirePermission(user.roleCode, RESOURCE.PAYMENT, ACTION.CREATE);
  } else {
    requirePermission(user.roleCode, RESOURCE.PAYMENT, ACTION.UPDATE);
  }
  return prisma.$transaction(async (tx) => {
    const commonLoad = (t: typeof tx) => t.payment.findFirst({
      where: { id, deletedAt: null, ...(ownerViaContract(user) as Prisma.PaymentWhereInput) },
    });
    const requireFinance = () => {
      if (user.roleCode !== "FINANCE" && user.roleCode !== "ADMIN") {
        throw new ApiError(ERROR_CODES.FORBIDDEN, `仅财务可${input.action === "confirm" ? "确认" : input.action === "reconcile" ? "对账" : "退款"}`, 403);
      }
    };
    const mismatch = { code: ERROR_CODES.ENTITY_IMMUTABLE, status: 403 } as const;
    const TOL = MONEY_TOLERANCE;

    if (input.action === "confirm") {
      requireFinance();
      const result = await runTransitionInTx(tx, {
        entity: "Payment",
        loadInTx: commonLoad,
        from: ["PLANNED"],
        to: "CONFIRMED",
        precondition: async (current, t) => {
          const ref = input.bankRefNo ?? current.bankRefNo;
          if (!ref) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "请填写银行流水号", 400);
          // 加分布式锁防止同一流水号并发确认导致重复
          await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ref})::bigint)`;
          // 对合同/发票行加锁, 序列化同一合同/发票下的并发确认, 防止累计金额超限
          await t.$queryRaw`SELECT id FROM "Contract" WHERE id = ${current.contractId} AND "deletedAt" IS NULL FOR UPDATE`;
          if (current.invoiceId) {
            await t.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${current.invoiceId} AND "deletedAt" IS NULL FOR UPDATE`;
          }
          // R-10: 流水号唯一 (在 CONFIRMED/RECONCILED 池里, 已删除记录不占号)
          const dup = await t.payment.findFirst({
            where: { bankRefNo: ref, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null, NOT: { id: current.id } },
          });
          if (dup) throw new ApiError(ERROR_CODES.PAYMENT_DUPLICATE_REF, `流水号 ${ref} 已存在`, 409);
          // R-11 (若挂发票): 累计回款 ≤ 发票金额
          if (current.invoiceId) {
            const inv = await t.invoice.findUniqueOrThrow({ where: { id: current.invoiceId } });
            const sum = await t.payment.aggregate({
              where: { invoiceId: current.invoiceId, status: { in: ["CONFIRMED", "RECONCILED"] }, NOT: { id: current.id } },
              _sum: { amount: true },
            });
            const sumAmt = new Prisma.Decimal(sum._sum.amount?.toString() ?? "0");
            const invAmt = new Prisma.Decimal(inv.amount.toString());
            if (sumAmt.plus(current.amount.toString()).greaterThan(invAmt.plus(TOL))) {
              throw new ApiError(ERROR_CODES.PAYMENT_OVER_INVOICE, "该发票累计回款将超过发票金额", 422);
            }
          }
          // R-12: 累计回款 ≤ 合同总额
          const sumC = await t.payment.aggregate({
            where: { contractId: current.contractId, status: { in: ["CONFIRMED", "RECONCILED"] }, NOT: { id: current.id } },
            _sum: { amount: true },
          });
          const contract = await t.contract.findUniqueOrThrow({ where: { id: current.contractId } });
          const sumCAmt = new Prisma.Decimal(sumC._sum.amount?.toString() ?? "0");
          const contractAmt = new Prisma.Decimal(contract.totalAmount.toString());
          if (sumCAmt.plus(current.amount.toString()).greaterThan(contractAmt.plus(TOL))) {
            throw new ApiError(ERROR_CODES.PAYMENT_OVER_CONTRACT, "该合同累计回款将超过合同总额", 422);
          }
        },
        extraData: (current) => ({
          bankRefNo: input.bankRefNo ?? current.bankRefNo,
          // 预建/登记时的 receivedAt 可能是开票时间快照, confirm 时允许更正为实际到账日
          ...(input.receivedAt ? { receivedAt: new Date(input.receivedAt) } : {}),
          ...(input.method ? { method: input.method } : {}),
        }),
        audit: (current) => {
          const ref = input.bankRefNo ?? current.bankRefNo;
          return {
            actorId: user.id,
            action: "PAYMENT_CONFIRM",
            before: { status: current.status, bankRefNo: current.bankRefNo },
            after: { status: "CONFIRMED", bankRefNo: ref },
          };
        },
        event: async (current, t) => {
          const ct = await t.contract.findUniqueOrThrow({ where: { id: current.contractId }, select: { ownerUserId: true } });
          const admins = await listAdminUserIds(t);
          const customer = await t.customer.findUniqueOrThrow({ where: { id: current.customerId }, select: { name: true } });
          return {
            type: "PAYMENT_RECEIVED",
            payload: { paymentId: current.id, paymentNo: current.paymentNo, amount: Number(current.amount), customerName: customer.name },
            entityKey: `PAYMENT_RECEIVED:${current.id}`,
            receivers: Array.from(new Set([ct.ownerUserId, current.recorderUserId, ...admins])),
          };
        },
        mismatchError: { ...mismatch, message: (_c, to) => `仅 PLANNED 可确认(目标: ${to})` },
      });
      return result.updated!;
    }

    if (input.action === "reconcile") {
      requireFinance();
      const result = await runTransitionInTx(tx, {
        entity: "Payment",
        loadInTx: commonLoad,
        from: ["CONFIRMED"],
        to: "RECONCILED",
        extraData: () => ({ reconcileUserId: user.id, reconciledAt: new Date() }),
        audit: () => ({ actorId: user.id, action: "PAYMENT_RECONCILE", before: { status: "CONFIRMED" }, after: { status: "RECONCILED" } }),
        mismatchError: { ...mismatch, message: (_c, to) => `仅 CONFIRMED 可对账(目标: ${to})` },
      });
      return result.updated!;
    }

    if (input.action === "refund") {
      requireFinance();
      const reason = (input.reason ?? "").trim();
      if (!reason) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "退款需填写原因", 400);
      const result = await runTransitionInTx(tx, {
        entity: "Payment",
        loadInTx: commonLoad,
        from: ["CONFIRMED", "RECONCILED"],
        to: "REFUNDED",
        // P1-2: 把原 payment 翻为 REFUNDED, 累计和 (R-11/R-12) 自动从 CONFIRMED/RECONCILED 池里掉出来
        // 退款即失去对账语义, 清空对账人/对账时间
        extraData: (current) => ({
          remark: `退款:${reason}${current.remark ? ` | 原备注:${current.remark}` : ""}`,
          reconcileUserId: null,
          reconciledAt: null,
          updatedById: user.id,
        }),
        audit: (current) => ({
          actorId: user.id,
          action: "PAYMENT_REFUND",
          before: { status: current.status, amount: Number(current.amount) },
          after: { status: "REFUNDED", reason },
        }),
        mismatchError: { ...mismatch, message: (_c, to) => `当前状态不可退款(目标: ${to})` },
      });
      return result.updated!;
    }

    if (input.action === "cancel") {
      const result = await runTransitionInTx(tx, {
        entity: "Payment",
        loadInTx: commonLoad,
        from: ["PLANNED"],
        to: "CANCELLED",
        precondition: (current) => {
          if (current.recorderUserId !== user.id && user.roleCode !== "ADMIN" && user.roleCode !== "FINANCE") {
            throw new ApiError(ERROR_CODES.FORBIDDEN, "仅创建人或财务可取消", 403);
          }
        },
        audit: (current) => ({
          actorId: user.id,
          action: "PAYMENT_CANCEL",
          before: { status: "PLANNED", amount: Number(current.amount), bankRefNo: current.bankRefNo },
          after: { status: "CANCELLED" },
        }),
        mismatchError: { ...mismatch, message: (_c, to) => `仅 PLANNED 可取消(目标: ${to})` },
      });
      return result.updated!;
    }

    if (input.action === "return") {
      // 实务: 财务确认后发现金额/流水号/到账日录错, 退回业务重录 (CONFIRMED -> PLANNED)。
      // 与 refund 的区别: refund 是实际退款给客户(终态, 资金流反转); return 只是登记错误回退,
      // 不产生资金流, 退回后保持 PLANNED 由业务/财务重新确认(confirm 支持覆盖流水号/到账日/方式)。
      requireFinance();
      const reason = (input.reason ?? "").trim();
      if (!reason) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "退回需填写原因", 400);
      const result = await runTransitionInTx(tx, {
        entity: "Payment",
        loadInTx: commonLoad,
        from: ["CONFIRMED"],
        to: "PLANNED",
        extraData: (current) => ({
          remark: `退回重录:${reason}${current.remark ? ` | 原备注:${current.remark}` : ""}`,
          updatedById: user.id,
        }),
        audit: (current) => ({
          actorId: user.id,
          action: "PAYMENT_RETURN",
          before: { status: current.status, amount: Number(current.amount), bankRefNo: current.bankRefNo },
          after: { status: "PLANNED", reason },
        }),
        mismatchError: { ...mismatch, message: (_c, to) => `仅 CONFIRMED 可退回(目标: ${to})` },
      });
      return result.updated!;
    }

    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未知动作", 400);
  }).then((r) => {
    flushPendingKicks();
    return r;
  });
}
