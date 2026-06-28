import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";

import {ownerEq} from "@/lib/ownership";
import { Prisma } from "@prisma/client";
import { audit } from "@/server/audit";
import { listAdminUserIds } from "@/server/events/bus";
import { runTransition, runTransitionInTx, SkipTransition } from "@/lib/status-machine";
import { SYSTEM_USER_ID } from "@/lib/system";
import { env } from "@/lib/env";

export async function publishContract(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.UPDATE);
  if (user.roleCode !== "ADMIN") throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可发布合同", 403);
  return prisma.$transaction(async (tx) => {
    const c = await tx.contract.findFirst({ where: { id, deletedAt: null, ...ownerEq(user) } });
    if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
    if (c.status !== "DRAFT") {
      throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, `当前状态 ${c.status} 不可发布（须 DRAFT）`, 403);
    }
    const before = { status: c.status };
    const updated = await tx.contract.update({ where: { id }, data: { status: "ACTIVE", updatedById: user.id } });
    await tx.contractReviewLog.create({
      data: { contractId: id, reviewerId: user.id, action: "MANUAL_PUBLISH", comment: "admin 强制发布" }
    });
    await audit(tx, {
      actorId: user.id, action: "CONTRACT_PUBLISH", entity: "Contract", entityId: id,
      before, after: { status: "ACTIVE" }
    });
    return updated;
  });
}


export type ContractCloseReason = "completed" | "terminated" | "expired" | "overdue_terminated";


/**
 * 强制完结: admin 手动从 ACTIVE 推到 CLOSED. reason 区分完结原因, 便于统计.
 * 自动完结 (tryAutoClose) 也走这个函数, source 标记 AUTO/MANUAL.
 */
export async function closeContract(
  user: SessionUser,
  id: string,
  reason: ContractCloseReason,
  source: "AUTO" | "MANUAL" = "MANUAL"
) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.UPDATE);
  if (source === "MANUAL" && user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可完结合同", 403);
  }
  return prisma.$transaction(async (tx) => {
    const c = await tx.contract.findFirst({ where: { id, deletedAt: null, ...ownerEq(user) } });
    if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
    if (c.status !== "ACTIVE") {
      throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, `当前状态 ${c.status} 不可完结（须 ACTIVE）`, 403);
    }
    const before = { status: c.status };
    const updated = await tx.contract.update({
      where: { id },
      data: { status: "CLOSED", reviewComment: reason, updatedById: user.id }
    });
    const action = source === "AUTO" ? `AUTO_CLOSE_${reason.toUpperCase()}` : "MANUAL_CLOSE";
    await tx.contractReviewLog.create({
      data: { contractId: id, reviewerId: user.id, action, comment: reason }
    });
    await audit(tx, {
      actorId: user.id,
      action: `CONTRACT_${action}`,
      entity: "Contract",
      entityId: id,
      before,
      after: { status: "CLOSED", reason }
    });
    return updated;
  });
}


// =====================================================
// P11: 合同 360 度视图
// =====================================================

export type PublishableCheck = {
  /** 是否满足 DRAFT → ACTIVE 自动发布的全部前置条件 */
  eligible: boolean;
  /** 缺失的字段/校验项(中英混合, 直接给前端展示用). eligible=true 时为空数组 */
  missing: string[];
};

/**
 * DRAFT → ACTIVE 校验: 字段完整 + 至少 1 附件.
 * 字段: customerId / contractNo / title / serviceType / signDate / startDate / endDate /
 *       totalAmount > 0 / taxRate >= 0 / ownerUserId / signerId + attachments.length > 0
 *
 * 返回结构化结果(而不是单纯 boolean)便于:
 *   - tryAutoPublish 内部 precondition 用 .eligible
 *   - GET /api/contracts/[id]/publish-eligibility 透传给前端, 让 admin 看到具体缺什么
 */
export function checkPublishable(c: {
  customerId: string;
  contractNo: string;
  title: string;
  serviceType: string;
  signDate: Date | null;
  startDate: Date | null;
  endDate: Date | null;
  totalAmount: { toString(): string } | number | string;
  taxRate: { toString(): string } | number | string;
  ownerUserId: string;
  signerId: string;
  attachments: unknown;
}): PublishableCheck {
  const missing: string[] = [];
  if (!c.customerId) missing.push("客户 (customerId)");
  if (!c.contractNo) missing.push("合同编号 (contractNo)");
  if (!c.title) missing.push("合同标题 (title)");
  if (!c.serviceType) missing.push("服务类型 (serviceType)");
  if (!c.signDate) missing.push("签订日期 (signDate)");
  if (!c.startDate) missing.push("开始日期 (startDate)");
  if (!c.endDate) missing.push("结束日期 (endDate)");
  const total = Number(c.totalAmount);
  const tax = Number(c.taxRate);
  if (!(total > 0)) missing.push("合同总额 > 0 (totalAmount)");
  if (!(tax >= 0)) missing.push("税率 >= 0 (taxRate)");
  if (!c.ownerUserId) missing.push("项目负责人 (ownerUserId)");
  if (!c.signerId) missing.push("签订人 (signerId)");
  const att = c.attachments;
  if (!Array.isArray(att) || att.length === 0) missing.push("至少 1 个附件 (attachments)");
  return { eligible: missing.length === 0, missing };
}

/** @deprecated 用 checkPublishable().eligible 替代; 保留仅为旧 caller 不破坏编译 */
export function isPublishable(c: Parameters<typeof checkPublishable>[0]): boolean {
  return checkPublishable(c).eligible;
}

/**
 * 在事务内尝试 DRAFT → ACTIVE. 状态不匹配 / 字段不满足 → 静默 no-op.
 * 写入 ContractReviewLog + audit + emit 通知. SYSTEM_USER_ID 作为 actor.
 */

export async function tryAutoPublish(tx: Prisma.TransactionClient, contractId: string): Promise<"PUBLISHED" | "SKIPPED"> {
  const result = await runTransitionInTx(
    tx,
    {
      entity: "Contract",
      loadInTx: (t) => t.contract.findFirst({
        where: { id: contractId, deletedAt: null },
        select: { id: true, status: true, contractNo: true, ownerUserId: true, signerId: true, customerId: true, title: true, serviceType: true, signDate: true, startDate: true, endDate: true, totalAmount: true, taxRate: true, attachments: true },
      }),
      from: ["DRAFT"],
      to: "ACTIVE",
      precondition: (c) => {
        // 字段不全视作 SKIPPED 静默跳过, 由后续 PATCH 重新评估
        if (!checkPublishable(c).eligible) throw new SkipTransition();
      },
      audit: (c) => ({
        actorId: SYSTEM_USER_ID,
        action: "CONTRACT_AUTO_PUBLISH",
        before: { status: c.status },
        after: { status: "ACTIVE" },
      }),
      reviewLog: () => ({
        reviewerId: SYSTEM_USER_ID,
        action: "AUTO_PUBLISH",
        comment: "字段完整 + 附件就位, 系统自动发布",
      }),
      event: async (c, t) => {
        const admins = await listAdminUserIds(t);
        return {
          type: "CONTRACT_AUTO_EXECUTED",
          payload: { contractId: c.id, contractNo: c.contractNo },
          receivers: Array.from(new Set([c.ownerUserId, ...admins])),
        };
      },
      silentSkip: true,
    },
  );
  return result.result === "DONE" ? "PUBLISHED" : "SKIPPED";
}

/**
 * R-07: 合同满足完结条件 → ACTIVE → CLOSED.
 *
 * 三个硬前置条件 (全部满足才关):
 *   1. endDate < now                  (合同已过自然到期日)
 *   2. 开票足额  (>= totalAmount * ratio, env CONTRACT_COMPLETION_INVOICE_RATIO)
 *   3. 回款足额  (CONFIRMED + RECONCILED 之和 >= totalAmount * ratio)
 *
 * 状态不匹配 / 任一前置条件不满足 → 静默 no-op.
 *
 * reason 在自动路径下恒为 "completed" (合同自然到期 + 钱齐了, 项目完结).
 *   - "expired" 作为 reason 仅用于 manual close (admin 选 expired 兜底);
 *     自动路径不再产生, 因为 endDate<now + 双足额 已经隐含 "expired", 但 reason 字段
 *     仍标 "completed" 跟 "人工因客户跑路标 terminated" 区分开。
 *   - "overdue_terminated" 由 tryAutoCloseOnOverdue (宽限期已过仍未结清) 产生。
 *
 * 注: DESIGN-v3.md R-07 提到的"项目全 ACCEPTED/CLOSED"在当前 schema 下无 Project 子表支撑,
 *     简化为仅校验开票+回款; 验收环节由 admin 在前端操作中体现 (人工确认后手动调 closeContract).
 */
export async function tryAutoClose(contractId: string, now: Date): Promise<"CLOSED" | "SKIPPED"> {
  const ratio = env.CONTRACT_COMPLETION_INVOICE_RATIO;
  const result = await runTransition({
    entity: "Contract",
    id: contractId,
    loadInTx: (tx) => tx.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, status: true, contractNo: true, totalAmount: true, endDate: true, ownerUserId: true },
    }),
    from: ["ACTIVE"],
    to: "CLOSED",
    precondition: async (c, tx) => {
      // 条件 1: endDate < now (合同已过自然到期日)
      if (new Date(c.endDate as unknown as Date) >= now) throw new SkipTransition();

      const total = Number(c.totalAmount);
      const threshold = total * ratio;

      // 条件 2: 开票足额
      const invoiced = await tx.invoice.aggregate({
        where: { contractId, status: "ISSUED", deletedAt: null },
        _sum: { amount: true },
      });
      if (Number(invoiced._sum.amount ?? 0) < threshold) throw new SkipTransition();

      // 条件 3: 回款足额 (CONFIRMED + RECONCILED 都算入账;PLANNED 不算)
      const paid = await tx.payment.aggregate({
        where: { contractId, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null },
        _sum: { amount: true },
      });
      if (Number(paid._sum.amount ?? 0) < threshold) throw new SkipTransition();
    },
    extraData: () => ({ reviewComment: "completed" as ContractCloseReason }),
    audit: () => ({
      actorId: SYSTEM_USER_ID,
      action: "CONTRACT_AUTO_CLOSE_COMPLETED",
      before: { status: "ACTIVE" },
      after: { status: "CLOSED", reason: "completed" },
    }),
    reviewLog: () => {
      const pct = (ratio * 100).toFixed(0);
      return {
        reviewerId: SYSTEM_USER_ID,
        action: "AUTO_CLOSE_COMPLETED",
        comment: `合同已过到期日且开票回款达到 ${pct}%, 系统自动完结`,
      };
    },
    event: async (c, tx) => {
      const admins = await listAdminUserIds(tx);
      return {
        type: "CONTRACT_AUTO_COMPLETED",
        payload: { contractId: c.id, contractNo: c.contractNo, reason: "completed", endDate: c.endDate },
        receivers: Array.from(new Set([c.ownerUserId, ...admins])),
      };
    },
    silentSkip: true,
  });
  return result.result === "DONE" ? "CLOSED" : "SKIPPED";
}

/**
 * 合同过期宽限期强关: endDate + GRACE_DAYS < now 仍未结清的合同
 * → ACTIVE → CLOSED (reason="overdue_terminated").
 *
 * 跟 tryAutoClose 的差别:
 *   - tryAutoClose 要求 endDate<now + 双足额 (钱齐了, 自然到期, 项目完结)
 *   - tryAutoCloseOnOverdue 要求 endDate+GRACE<now + 未结清 (钱没收齐, 但拖太久了)
 *
 * 设计动机: 248 个 endDate 已过但未结清的合同, 如果不强制, 会无限期 ACTIVE.
 * 加宽限期是给客户缓冲, 超期不结清就强关 + 通知, 财务也能承认坏账。
 *
 * GRACE_DAYS 来自 env.CONTRACT_OVERDUE_GRACE_DAYS (默认 60)。
 * 单笔失败不影响其它; 走完整事务+重试。
 */
export async function tryAutoCloseOnOverdue(contractId: string, now: Date): Promise<"CLOSED" | "SKIPPED"> {
  const ratio = env.CONTRACT_COMPLETION_INVOICE_RATIO;
  const graceMs = env.CONTRACT_OVERDUE_GRACE_DAYS * 86_400_000;
  const result = await runTransition({
    entity: "Contract",
    id: contractId,
    loadInTx: (tx) => tx.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, status: true, contractNo: true, totalAmount: true, endDate: true, ownerUserId: true },
    }),
    from: ["ACTIVE"],
    to: "CLOSED",
    precondition: async (c, tx) => {
      // 条件 1: endDate + GRACE_DAYS < now
      const graceCutoff = new Date(new Date(c.endDate as unknown as Date).getTime() + graceMs);
      if (graceCutoff >= now) throw new SkipTransition();

      const total = Number(c.totalAmount);
      const threshold = total * ratio;

      // 条件 2: 必须未结清 (paid < threshold); 双足额的情况由 tryAutoClose 处理
      const paid = await tx.payment.aggregate({
        where: { contractId, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null },
        _sum: { amount: true },
      });
      if (Number(paid._sum.amount ?? 0) >= threshold) throw new SkipTransition();
    },
    extraData: () => ({ reviewComment: "overdue_terminated" as ContractCloseReason }),
    audit: () => ({
      actorId: SYSTEM_USER_ID,
      action: "CONTRACT_AUTO_CLOSE_OVERDUE_TERMINATED",
      before: { status: "ACTIVE" },
      after: { status: "CLOSED", reason: "overdue_terminated" },
    }),
    reviewLog: () => ({
      reviewerId: SYSTEM_USER_ID,
      action: "AUTO_CLOSE_OVERDUE_TERMINATED",
      comment: `合同已过到期日 + 宽限期 ${env.CONTRACT_OVERDUE_GRACE_DAYS} 天仍未结清, 系统强关`,
    }),
    event: async (c, tx) => {
      const admins = await listAdminUserIds(tx);
      return {
        type: "CONTRACT_AUTO_OVERDUE_TERMINATED",
        payload: { contractId: c.id, contractNo: c.contractNo, reason: "overdue_terminated", endDate: c.endDate, graceDays: env.CONTRACT_OVERDUE_GRACE_DAYS },
        receivers: Array.from(new Set([c.ownerUserId, ...admins])),
      };
    },
    silentSkip: true,
  });
  return result.result === "DONE" ? "CLOSED" : "SKIPPED";
}
