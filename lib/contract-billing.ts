// 合同开票状态派生工具:由已开票金额(invoiced)与合同总额(total)比较得出。
// 服务端列表/详情/导出复用,前端列表/详情通过 import @/lib/contract-billing 复用。
//
// 语义(与 server/services/statistics.ts 中 getBillingStatus 一致):
//   - invoiced < TOLERANCE            → NOT_STARTED  未开票(0/微小正数/负净额均视为未开票)
//   - invoiced == TOLERANCE           → IN_PROGRESS  开票中(0.01 元=DB 最小精度, 视为已开)
//   - 0 < invoiced < total - 0.01   → IN_PROGRESS  开票中(0.01 元起算, DB 最小精度)
//   - invoiced >= total - 0.01      → COMPLETED    开票已完成
//
// 不容忍浮点误差: COMPLETED 判定用 0.01 元容差,避免 decimal 转 number 后产生
// 0.0000001 的余项让 100.00 元的合同被 99.9999999 元判定为未完成。
// NOT_STARTED 用 < TOLERANCE (非 <=): 0.01 元 = TOLERANCE = DB 最小精度,
// 视为已开(走 IN_PROGRESS); 0、负数、0.005 等 < TOLERANCE 的均视为未开,
// 避免 decimal→number 残留(如 0.00499999)被误判为 IN_PROGRESS。
import type { BillingStatus, PaymentProgressStatus } from "@/types/enums";
import { MONEY_TOLERANCE } from "@/lib/money-tolerance";

const TOLERANCE = MONEY_TOLERANCE.toNumber();

export function getBillingStatus(invoicedAmount: number, totalAmount: number): BillingStatus {
  const total = Number(totalAmount) || 0;
  const invoiced = Number(invoicedAmount) || 0;
  if (invoiced < TOLERANCE) return "NOT_STARTED";
  if (invoiced + TOLERANCE >= total) return "COMPLETED";
  return "IN_PROGRESS";
}

// 合同回款状态派生:由 paidAmount 与 totalAmount 比较得出, 与 getBillingStatus 对称。
// 语义:
//   - paid <= TOLERANCE       -> NOT_STARTED  未回款(0/微小正数/负净额)
//   - 0 < paid < total-0.01   -> IN_PROGRESS  回款中
//   - paid >= total-0.01      -> COMPLETED    回款已完成
//
// 容差复用 MONEY_TOLERANCE (0.01 元), 处理 decimal -> number 残留.
export function getPaymentStatus(paidAmount: number, totalAmount: number): PaymentProgressStatus {
  const total = Number(totalAmount) || 0;
  const paid = Number(paidAmount) || 0;
  if (paid < TOLERANCE) return "NOT_STARTED";
  if (paid + TOLERANCE >= total) return "COMPLETED";
  return "IN_PROGRESS";
}
