// 客户状态机自动化 (§2.3) 事件触发入口
//
// 在合同状态机的 2 个写点调本文件:
//   - 合同 DRAFT -> ACTIVE (tryAutoPublish 触发, createContract/updateContract 调用点):
//     onContractActivated(contractId) -> autoChangeCustomerStatus({ rule: CONTRACT_ACTIVATED })
//   - 合同 ACTIVE -> CLOSED (tryAutoClose / tryAutoCloseOnOverdue 触发):
//     onContractClosed(contractId) -> autoChangeCustomerStatus({ rule: ALL_CONTRACTS_CLOSED })
//
// 关键约束:
//   - 不能嵌套 prisma 事务 —— 调用方 (crud.ts / status.ts) 已经在 prisma.$transaction 里
//     跑了 tryAutoPublish, 我们的 autoChangeCustomerStatus 自己再开一个独立事务
//   - 不抛错: autoChangeCustomerStatus 是 silentSkip 模式, 内部已经处理 4 种 SKIPPED reason
//   - 没找到 customerId (合同 deletedAt 不为空) 直接 no-op, 不抛错
import { prisma } from "@/lib/prisma";
import { autoChangeCustomerStatus } from "./status";
import type { CustomerAutoRuleId } from "@/lib/customer-auto-rules";

/**
 * 合同 DRAFT -> ACTIVE 后调用: 尝试把对应客户改成 SIGNED.
 * 失败 (前置条件不满足 / 客户状态已被人改过) 时静默 no-op, 不影响合同提交流程.
 */
export async function onContractActivated(contractId: string): Promise<void> {
  const c = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: { customerId: true }
  });
  if (!c) return;
  await autoChangeCustomerStatus({
    customerId: c.customerId,
    rule: "CONTRACT_ACTIVATED" satisfies CustomerAutoRuleId
  });
}

/**
 * 合同 ACTIVE -> CLOSED 后调用: 尝试把对应客户改成 FROZEN (前提是所有合同都已 CLOSED).
 * 失败时静默 no-op.
 */
export async function onContractClosed(contractId: string): Promise<void> {
  const c = await prisma.contract.findFirst({
    where: { id: contractId, deletedAt: null },
    select: { customerId: true }
  });
  if (!c) return;
  await autoChangeCustomerStatus({
    customerId: c.customerId,
    rule: "ALL_CONTRACTS_CLOSED" satisfies CustomerAutoRuleId
  });
}
