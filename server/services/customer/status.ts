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

