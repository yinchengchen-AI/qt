// 合同开票状态派生工具:由已开票金额(invoiced)与合同总额(total)比较得出。
// 服务端列表/详情/导出复用,前端列表/详情通过 import @/lib/contract-billing 复用。
//
// 语义(与 server/services/statistics.ts:18-30 一致):
//   - invoiced = 0                  → NOT_STARTED  未开盘
//   - 0 < invoiced < total          → IN_PROGRESS  开盘中
//   - invoiced >= total             → COMPLETED    开盘已完成
//
// 不容忍浮点误差:用 0.01 元容差,避免 decimal 转 number 后产生 0.0000001 的余项
// 让 100.00 元的合同被 99.9999999 元判定为未完成。
import type { BillingStatus } from "@/types/enums";

const TOLERANCE = 0.01;

export function getBillingStatus(invoicedAmount: number, totalAmount: number): BillingStatus {
  const total = Number(totalAmount) || 0;
  const invoiced = Number(invoicedAmount) || 0;
  if (invoiced <= TOLERANCE) return "NOT_STARTED";
  if (invoiced + TOLERANCE >= total) return "COMPLETED";
  return "IN_PROGRESS";
}
