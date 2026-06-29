import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { ownerEq } from "@/lib/ownership";
import { audit } from "@/server/audit";

/**
 * 合同重新打开的原因枚举. 用于 reopenContract 接口, 写进 ContractReviewLog.comment
 * + audit log, 方便后续追溯 reopen 的真实原因.
 *
 * 设计原则: 用固定枚举 + 可选 reasonNote, 避免自由文本污染审计字段.
 * 新增 reason 时: 同步更新 reopenReasonSchema (lib/validators/contract.ts).
 */
export const REOPEN_REASONS = [
  "recovered_from_fake_close", // cron 误关恢复 (常用于 overdue_terminated 的批量恢复)
  "data_correction",            // 管理员手工修正错误关闭
  "reopen_for_payment",         // 财务补录回款 (合同已正常完结但漏录付款)
  "other",                      // 其它原因, 必填 reasonNote 说明
] as const;

export type ContractReopenReason = (typeof REOPEN_REASONS)[number];

/**
 * Admin 重新打开已完结合同: CLOSED → ACTIVE
 *
 * 触发场景:
 *   1. cron 任务长期未跑, 大量合同被 tryAutoCloseOnOverdue 强关 (reason=overdue_terminated),
 *      现在恢复运行后需要批量恢复, 让财务补录回款
 *   2. admin 手动 closeContract 后发现误操作, 需要重开
 *   3. 合同正常完结 (reason=completed) 但财务漏录部分回款, 临时重开补录
 *
 * 限制:
 *   - 仅 ADMIN 角色可调用 (审计可追溯)
 *   - 当前状态必须为 CLOSED (DRAFT / ACTIVE 拒绝, ENTITY_IMMUTABLE 403)
 *   - 走完整事务 + ContractReviewLog + audit log
 *   - reviewComment 改为 "reopened:<reason>" 作为审计标记
 *
 * ⚠️ 注意: 重开后如果合同仍然满足 tryAutoCloseOnOverdue 条件
 *   (endDate + GRACE_DAYS < now + 未结清), 下次 cron 跑还会再次被强关.
 *   所以应当: 重开 → 财务补录 → 让 tryAutoClose 走 completed 路径.
 *
 * 数据修复批量脚本另见:
 *   scripts/migrate/contract-fake-close-recovery.ts
 */
export async function reopenContract(
  user: SessionUser,
  id: string,
  reason: ContractReopenReason,
  reasonNote?: string,
) {
  requirePermission(user.roleCode, RESOURCE.CONTRACT, ACTION.UPDATE);
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可重新打开合同", 403);
  }
  if (reason === "other" && !reasonNote?.trim()) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "reason=other 时必须填写 reasonNote 说明", 400);
  }

  return prisma.$transaction(async (tx) => {
    // 用 ownerEq 跟其它 service 一致; ADMIN 是全可见, 这里不影响行为但保持统一
    const c = await tx.contract.findFirst({
      where: { id, deletedAt: null, ...ownerEq(user) },
      select: { id: true, status: true, contractNo: true, totalAmount: true, endDate: true, ownerUserId: true },
    });
    if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
    if (c.status !== "CLOSED") {
      throw new ApiError(
        ERROR_CODES.ENTITY_IMMUTABLE,
        `当前状态 ${c.status} 不可重新打开（须 CLOSED）`,
        403,
      );
    }

    const before = { status: c.status };
    const noteSuffix = reasonNote?.trim() ? `:${reasonNote.trim().slice(0, 200)}` : "";
    const updated = await tx.contract.update({
      where: { id },
      data: {
        status: "ACTIVE",
        // 用 "reopened:<reason>" 前缀作为审计标记, 后续查询/统计可识别
        reviewComment: `reopened:${reason}${noteSuffix}`,
        updatedById: user.id,
      },
    });
    await tx.contractReviewLog.create({
      data: {
        contractId: id,
        reviewerId: user.id,
        action: "MANUAL_REOPEN",
        comment: `数据修复:从 CLOSED 重新打开为 ACTIVE. reason=${reason}${reasonNote ? ` (${reasonNote})` : ""}`,
      },
    });
    await audit(tx, {
      actorId: user.id,
      action: "CONTRACT_MANUAL_REOPEN",
      entity: "Contract",
      entityId: id,
      before,
      after: { status: "ACTIVE", reason, reasonNote: reasonNote ?? null },
    });
    return updated;
  });
}