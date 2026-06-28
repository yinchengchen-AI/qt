import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { Prisma } from "@prisma/client";

import {ownerEq} from "@/lib/ownership";
import { runTransitionInTx } from "@/lib/status-machine";
import { ALLOWED_TRANSITIONS_BY_TARGET, isCustomerStatus } from "@/lib/customer-status-transitions";

export async function changeCustomerStatus(
  user: SessionUser,
  id: string,
  status: string,
  reason?: string
) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.UPDATE);
  return prisma.$transaction(
    async (tx) => {
      // 行锁: 把目标行锁住, 防止两个并发 PATCH 抢同一行导致丢更新
      // Prisma 不直接暴露 FOR UPDATE, 用 $queryRaw 配合 Prisma.sql 模板保证参数化
      // SALES 角色只在有权限的行上加锁, 避免锁到无权访问的数据
      const ownerClause = user.roleCode === "SALES"
        ? Prisma.sql` AND "ownerUserId" = ${user.id}`
        : Prisma.sql``;
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "Customer" WHERE id = ${id}${ownerClause} FOR UPDATE`
      );
      if (locked.length === 0) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
      }
      // 校验目标状态是合法枚举 (防御性兜底, 与原 assertCanTransition 的 isCustomerStatus 检查一致)
      if (!isCustomerStatus(status)) {
        throw new ApiError(
          ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID,
          `客户状态变更目标非法: ${status}`,
          422,
        );
      }
      // 走 runTransitionInTx 做 from 检查 + precondition (业务校验) + update + audit
      const result = await runTransitionInTx(
        tx,
        {
          entity: "Customer",
          loadInTx: (t) => t.customer.findFirst({
            where: { id, deletedAt: null, ...ownerEq(user) },
            select: { id: true, status: true, name: true, ownerUserId: true },
          }),
          from: ALLOWED_TRANSITIONS_BY_TARGET[status] as readonly string[],
          to: status,
          // 1) 终态变更必填 reason: LOST / FROZEN 涉及"为什么"信息, 不允许无原因写入
          // 2) R-02: SIGNED 需至少 1 份生效中(ACTIVE)合同
          // 3) R-13: FROZEN 检查 — 先看活跃合同, 再看未对账回款 (顺序对应错误码提示)
          precondition: async (current, t) => {
            if ((status === "LOST" || status === "FROZEN") && !reason) {
              throw new ApiError(
                ERROR_CODES.CUSTOMER_STATUS_REASON_REQUIRED,
                `客户状态变更为 ${status} 需要填写原因`,
                422,
              );
            }
            if (status === "SIGNED") {
              const cnt = await t.contract.count({
                where: { customerId: id, status: "ACTIVE" },
              });
              if (cnt === 0) {
                throw new ApiError(ERROR_CODES.CUSTOMER_STATUS_INVALID, "客户需至少一份生效中的合同", 422);
              }
            }
            if (status === "FROZEN") {
              const activeContract = await t.contract.count({
                where: { customerId: id, status: { in: ["ACTIVE"] } },
              });
              if (activeContract > 0) {
                throw new ApiError(ERROR_CODES.CUSTOMER_HAS_ACTIVE_CONTRACT, "客户存在进行中合同,无法冻结", 422);
              }
              const activePayment = await t.payment.count({
                where: { customerId: id, status: { in: ["PLANNED", "CONFIRMED"] }, deletedAt: null },
              });
              if (activePayment > 0) {
                throw new ApiError(ERROR_CODES.CUSTOMER_FROZEN_ACTIVE_PAYMENT, "客户存在未对账回款,无法冻结", 422);
              }
            }
          },
          audit: (current) => ({
            actorId: user.id,
            action: "CUSTOMER_STATUS_CHANGE",
            before: { status: current.status },
            after: { status, ...(reason ? { reason } : {}) },
          }),
          // 状态不匹配时保留原 errorCode (CUSTOMER_STATUS_TRANSITION_INVALID, 422) — 与原 assertCanTransition 一致
          mismatchError: {
            code: ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID,
            status: 422,
            message: (current, to) => `客户状态 ${current.status} → ${to} 不允许`,
          },
        },
      );
      if (result.result === "SKIPPED") {
        throw new ApiError(
          ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID,
          `客户状态 ${status} 不允许`,
          422,
        );
      }
      // 拿回更新后的记录返回
      return result.updated ?? null;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 },
  );
}


// =====================================================
// P 客户状态机自动化 (§2.3 / §2.4): 系统自动写 + 人工撤销
// =====================================================
//
// autoChangeCustomerStatus: 业务事件 / 时间窗触发, silentSkip 模式
//   - 不抛 ApiError, 改不动就 SKIPPED (例如系统想写成 SIGNED 但客户已被人工改成 SIGNED)
//   - 写 Customer.lastAutoAppliedAt / lastAutoRule (用于详情页横幅 + 撤销窗口)
//   - audit action = CUSTOMER_STATUS_AUTO_CHANGE, actorId = SYSTEM_USER_ID
//   - emit CUSTOMER_STATUS_AUTO_APPLIED 给 owner
//
// revertCustomerStatus: 7 天窗口期内, owner / SALES / ADMIN 撤销系统自动写
//   - 校验 dispute window 未过 (CUSTOMER_AUTO_DISPUTE_DAYS)
//   - 校验客户当前 status 等于 lastAutoRule 对应的目标 (防竞态)
//   - 走合法状态机迁移 (targetStatus → NEGOTIATING), 不直写
//   - audit action = CUSTOMER_STATUS_REVERT, actorId = user.id
//   - emit CUSTOMER_STATUS_AUTO_REVERTED 给 owner
// =====================================================

import { SYSTEM_USER_ID } from "@/lib/system";
import { env } from "@/lib/env";
import { audit } from "@/server/audit";
import { emit } from "@/server/events/bus";
import { CUSTOMER_AUTO_RULES, type CustomerAutoRuleId } from "@/lib/customer-auto-rules";
import type { CustomerStatus } from "@/types/enums";

/** autoChangeCustomerStatus 的返回值. SKIPPED 时不抛错, 让调用方继续做其他事 */
export type AutoChangeResult =
  | { result: "DONE"; from: CustomerStatus; to: CustomerStatus }
  | { result: "SKIPPED"; reason: "not_found" | "from_mismatch" | "r02_failed" | "r13_failed" | "rule_mismatch" };

/**
 * 系统自动改客户状态. 走 prisma.$transaction + Serializable + 行锁 + runTransitionInTx 模式,
 * 与 server/services/contract/status.ts:tryAutoPublish 保持一致.
 *
 * 关键点:
 *   - 不绑定 user 角色 (走 admin 视角, 不加 ownerClause)
 *   - silentSkip: 改不动就返回 SKIPPED, 不抛错 (业务事件触发时绝不能打断)
 *   - 写 Customer.lastAutoAppliedAt + lastAutoRule (撤销窗口用)
 *   - audit.action = "CUSTOMER_STATUS_AUTO_CHANGE", actorId = SYSTEM_USER_ID
 *   - emit CUSTOMER_STATUS_AUTO_APPLIED 给 owner (event 不在 runTransitionInTx 里, 因为
 *     这里 status 字段更新里还要附带 lastAutoAppliedAt/lastAutoRule, 由 runTransitionInTx
 *     之外的 update 写; 事件在 update 之后发)
 *
 * 业务校验 (R-02 / R-13) 走 PRECONDITION in runTransitionInTx 之前, 由调用方保证.
 * 这里只做 from 校验 + 业务校验的"最少够用"版本 (SIGNED→ACTIVE 合同, FROZEN→无活跃合同+无未对账),
 * 让 silentSkip 语义自然落地.
 */
export async function autoChangeCustomerStatus(input: {
  customerId: string;
  rule: CustomerAutoRuleId;
}): Promise<AutoChangeResult> {
  const rule = CUSTOMER_AUTO_RULES[input.rule];
  if (!rule) {
    throw new Error(`unknown customer auto rule: ${input.rule}`);
  }
  const target: CustomerStatus = rule.targetStatus;

  return prisma.$transaction(
    async (tx) => {
      // 行锁 (不绑定 SALES, 系统调用走 admin 视角)
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "Customer" WHERE id = ${input.customerId} FOR UPDATE`
      );
      if (locked.length === 0) {
        return { result: "SKIPPED" as const, reason: "not_found" as const };
      }
      const existing = await tx.customer.findFirst({
        where: { id: input.customerId, deletedAt: null },
        select: { id: true, status: true, name: true, ownerUserId: true }
      });
      if (!existing) {
        return { result: "SKIPPED" as const, reason: "not_found" as const };
      }
      // from 校验: 客户当前状态必须在 ALLOWED_TRANSITIONS_BY_TARGET[target] 内
      const allowedFrom = ALLOWED_TRANSITIONS_BY_TARGET[target] as readonly string[];
      if (!allowedFrom.includes(existing.status)) {
        return { result: "SKIPPED" as const, reason: "from_mismatch" as const };
      }
      // 业务校验 R-02: → SIGNED 需至少 1 份 ACTIVE 合同
      if (target === "SIGNED") {
        const cnt = await tx.contract.count({ where: { customerId: input.customerId, status: "ACTIVE" } });
        if (cnt === 0) {
          return { result: "SKIPPED" as const, reason: "r02_failed" as const };
        }
      }
      // 业务校验 R-13: → FROZEN 需无活跃合同 + 无未对账回款
      if (target === "FROZEN") {
        const activeContract = await tx.contract.count({
          where: { customerId: input.customerId, status: { in: ["ACTIVE"] } }
        });
        if (activeContract > 0) {
          return { result: "SKIPPED" as const, reason: "r13_failed" as const };
        }
        const activePayment = await tx.payment.count({
          where: { customerId: input.customerId, status: { in: ["PLANNED", "CONFIRMED"] }, deletedAt: null }
        });
        if (activePayment > 0) {
          return { result: "SKIPPED" as const, reason: "r13_failed" as const };
        }
      }
      // 写: 状态 + lastAutoAppliedAt + lastAutoRule + updatedById
      await tx.customer.update({
        where: { id: input.customerId },
        data: {
          status: target,
          lastAutoAppliedAt: new Date(),
          lastAutoRule: input.rule,
          updatedById: SYSTEM_USER_ID
        },
        select: { id: true, status: true, name: true, ownerUserId: true }
      });
      // audit
      await audit(tx, {
        actorId: SYSTEM_USER_ID,
        action: "CUSTOMER_STATUS_AUTO_CHANGE",
        entity: "Customer",
        entityId: input.customerId,
        before: { status: existing.status },
        after: { status: target, rule: input.rule, reason: rule.reasonHint }
      });
      // 事件: 给 owner 发通知. lastAutoAppliedAt / lastAutoRule 由 UI 详情页拉取, 这里 payload
      // 只传跳转需要的最小信息.
      await emit(tx, {
        type: "CUSTOMER_STATUS_AUTO_APPLIED",
        payload: {
          customerId: input.customerId,
          customerName: existing.name,
          from: existing.status,
          to: target,
          rule: input.rule,
          ruleLabel: rule.label
        },
        receivers: [existing.ownerUserId]
      });
      return { result: "DONE" as const, from: existing.status as CustomerStatus, to: target };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 }
  );
}

/** revertCustomerStatus 的入参 */
export type RevertInput = {
  customerId: string;
  /** 撤销理由 (5-200 字, 必填, 进 audit.after.reason) */
  reason: string;
};

/**
 * 人工撤销系统自动改的客户状态.
 *
 * 流程:
 *   1) 校验 lastAutoAppliedAt 非空 + 距今 ≤ CUSTOMER_AUTO_DISPUTE_DAYS 天
 *   2) 校验当前 status == lastAutoRule 对应的 target (防被人改过, 见 §2.4 第 2 步)
 *   3) 走 ALLOWED_TRANSITIONS_BY_TARGET 的合法迁移, target → NEGOTIATING
 *   4) update + 清 lastAutoAppliedAt + 写 audit + 发 CUSTOMER_STATUS_AUTO_REVERTED
 *
 * 异常: 失败时抛 ApiError, 422/403/404 由调用方统一包成 HTTP.
 */
export async function revertCustomerStatus(
  user: SessionUser,
  input: RevertInput
) {
  requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.UPDATE);
  // SALES 行级隔离: SALES 只能撤销自己负责的客户的自动写
  const ownerClause = user.roleCode === "SALES"
    ? Prisma.sql` AND "ownerUserId" = ${user.id}`
    : Prisma.sql``;

  return prisma.$transaction(
    async (tx) => {
      // 行锁
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "Customer" WHERE id = ${input.customerId}${ownerClause} FOR UPDATE`
      );
      if (locked.length === 0) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
      }
      const existing = await tx.customer.findFirst({
        where: { id: input.customerId, deletedAt: null },
        select: {
          id: true,
          status: true,
          name: true,
          ownerUserId: true,
          lastAutoAppliedAt: true,
          lastAutoRule: true
        }
      });
      if (!existing) {
        throw new ApiError(ERROR_CODES.NOT_FOUND, "客户不存在", 404);
      }
      // 1) 校验 dispute window
      if (!existing.lastAutoAppliedAt || !existing.lastAutoRule) {
        throw new ApiError(
          ERROR_CODES.CUSTOMER_AUTO_REVERT_TARGET_INVALID,
          "该客户最近没有系统自动改的状态, 无需撤销",
          422
        );
      }
      const disputeMs = env.CUSTOMER_AUTO_DISPUTE_DAYS * 86_400_000;
      const ageMs = Date.now() - existing.lastAutoAppliedAt.getTime();
      if (ageMs > disputeMs) {
        throw new ApiError(
          ERROR_CODES.CUSTOMER_AUTO_DISPUTE_EXPIRED,
          `已超过 ${env.CUSTOMER_AUTO_DISPUTE_DAYS} 天撤销窗口期, 不能撤销`,
          403
        );
      }
      // 2) 校验当前 status == lastAutoRule 对应的 target (防被人改过)
      const rule = CUSTOMER_AUTO_RULES[existing.lastAutoRule as CustomerAutoRuleId];
      const expectedTarget = rule?.targetStatus;
      if (!expectedTarget || existing.status !== expectedTarget) {
        throw new ApiError(
          ERROR_CODES.CUSTOMER_AUTO_REVERT_TARGET_INVALID,
          `客户当前状态 ${existing.status} 与系统自动改的状态 ${expectedTarget ?? "?"} 不一致, 不能撤销`,
          422
        );
      }
      // 3) 走 runTransitionInTx: targetStatus → rule.revertTarget (per-rule 配置, 见
      //    lib/customer-auto-rules.ts). 3 个 LOST/FROZEN 规则回 NEGOTIATING, CONTRACT_ACTIVATED
      //    (→ SIGNED) 回 FROZEN —— 因为状态机不允许 SIGNED → NEGOTIATING (§2.4 决策).
      const revertTarget = rule.revertTarget;
      const result = await runTransitionInTx(
        tx,
        {
          entity: "Customer",
          loadInTx: (t) => t.customer.findFirst({
            where: { id: input.customerId, deletedAt: null, ...ownerEq(user) },
            select: { id: true, status: true, name: true, ownerUserId: true }
          }),
          from: ALLOWED_TRANSITIONS_BY_TARGET[revertTarget] as readonly string[],
          to: revertTarget,
          extraData: () => ({
            // 清 lastAutoAppliedAt + lastAutoRule, 让 UI 横幅消失
            lastAutoAppliedAt: null,
            lastAutoRule: null
          }),
          audit: (current) => ({
            actorId: user.id,
            action: "CUSTOMER_STATUS_REVERT",
            before: { status: current.status },
            after: {
              status: revertTarget,
              reason: input.reason,
              revertedFrom: expectedTarget,
              revertedRule: existing.lastAutoRule
            }
          }),
          event: async (current) => ({
            type: "CUSTOMER_STATUS_AUTO_REVERTED",
            payload: {
              customerId: current.id,
              customerName: current.name,
              from: expectedTarget,
              to: revertTarget,
              reason: input.reason
            },
            receivers: [current.ownerUserId]
          }),
          mismatchError: {
            code: ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID,
            status: 422,
            message: (current, to) =>
              `撤销路径 ${current.status} → ${to} 不被状态机允许`
          }
        }
      );
      if (result.result === "SKIPPED") {
        // runTransitionInTx 的 from 不匹配 (理论上前面已经校验过, 这里是防御)
        throw new ApiError(
          ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID,
          `撤销路径 ${existing.status} → ${revertTarget} 不被状态机允许`,
          422
        );
      }
      return { customerId: input.customerId, from: expectedTarget, to: revertTarget };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 }
  );
}
