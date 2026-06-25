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


export type ContractCloseReason = "completed" | "terminated" | "expired";


/**
 * 强制完结: admin 手动从 ACTIVE 推到 CLOSED. reason 区分完结原因, 便于统计.
 * 自动完结 (tryAutoComplete / tryAutoCloseOnExpiry) 也走这个函数, source 标记 AUTO/MANUAL.
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

export function isPublishable(c: {
  customerId: string;
  contractNo: string;
  title: string;
  serviceType: string;
  signDate: Date;
  startDate: Date;
  endDate: Date;
  totalAmount: { toString(): string } | number | string;
  taxRate: { toString(): string } | number | string;
  ownerUserId: string;
  signerId: string;
  attachments: unknown;
}): boolean {
  if (!c.customerId || !c.contractNo || !c.title || !c.serviceType) return false;
  if (!c.signDate || !c.startDate || !c.endDate) return false;
  const total = Number(c.totalAmount);
  const tax = Number(c.taxRate);
  if (!(total > 0) || !(tax >= 0)) return false;
  if (!c.ownerUserId || !c.signerId) return false;
  const att = c.attachments;
  if (!Array.isArray(att) || att.length === 0) return false;
  return true;
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
        if (!isPublishable(c)) throw new SkipTransition();
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
 * R-07: 合同满足完结条件 → ACTIVE → CLOSED (reason=completed)
 *   - 所有 Project.status ∈ {ACCEPTED, CLOSED}
 *   - SUM(Invoice.amount where status=ISSUED) >= contract.totalAmount * completionInvoiceRatio
 * 完结比例从 env 读 (默认 0.95). 状态不匹配 / 条件不满足 → 静默 no-op.
 */

export async function tryAutoComplete(contractId: string, now: Date): Promise<"CLOSED" | "SKIPPED"> {
  // now 当前未使用, 保留参数便于将来加"开票时效"等条件
  void now;
  const ratio = env.CONTRACT_COMPLETION_INVOICE_RATIO;
  const result = await runTransition({
    entity: "Contract",
    id: contractId,
    loadInTx: (tx) => tx.contract.findFirst({
      where: { id: contractId, deletedAt: null },
      select: { id: true, status: true, contractNo: true, totalAmount: true, ownerUserId: true },
    }),
    from: ["ACTIVE"],
    to: "CLOSED",
    // R-07: 完结条件 — 开票已足额 (>= totalAmount * ratio)
    // 注: DESIGN-v3.md R-07 提到的"项目全 ACCEPTED/CLOSED"在当前 schema 下无 Project 子表支撑,
    //     简化为仅校验开票; 验收环节由 admin 在前端操作中体现 (人工确认后手动调 closeContract).
    precondition: async (c, tx) => {
      const invoiced = await tx.invoice.aggregate({
        where: { contractId, status: "ISSUED", deletedAt: null },
        _sum: { amount: true },
      });
      const invoicedAmount = Number(invoiced._sum.amount ?? 0);
      const total = Number(c.totalAmount);
      if (invoicedAmount < total * ratio) throw new SkipTransition();
    },
    extraData: () => ({ reviewComment: "completed" }),
    audit: (c) => ({
      actorId: SYSTEM_USER_ID,
      action: "CONTRACT_AUTO_CLOSE_COMPLETED",
      before: { status: c.status },
      after: { status: "CLOSED", reason: "completed" },
    }),
    reviewLog: () => ({
      reviewerId: SYSTEM_USER_ID,
      action: "AUTO_CLOSE_COMPLETED",
      comment: `项目已验收, 开票达到 ${(ratio * 100).toFixed(0)}%, 系统自动完结`,
    }),
    event: async (c, tx) => {
      const admins = await listAdminUserIds(tx);
      return {
        type: "CONTRACT_AUTO_COMPLETED",
        payload: { contractId: c.id, contractNo: c.contractNo, reason: "completed" },
        receivers: Array.from(new Set([c.ownerUserId, ...admins])),
      };
    },
    silentSkip: true,
  });
  return result.result === "DONE" ? "CLOSED" : "SKIPPED";
}
