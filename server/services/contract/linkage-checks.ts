// 联动补盲判定 (Phase 3, spec §6.1)
//
// 两条检查被 daily-linkage-check job 与合同详情页 overview warnings 共用,
// 抽在这里保证两边口径同源 (防 job 提醒与页面预警不一致)。
//
// 判定 A 超期未开票: ACTIVE 且 startDate <= now-30d 且无已开票发票
//   (与 stale-contract.ts / 工作台 no_invoice 待办的 INVOICE_ISSUED_AMOUNT_STATUSES 口径一致)
// 判定 B 开票-回款偏差: 已开票 >= 1 万 且 (已开票-已回款)/已开票 > 20%
//   且最新发票 actualIssueDate <= now-30d
//   (与 INVOICE_OVERDUE_PAYMENT 按发票粒度互补: 本条按合同聚合, spec §6.1)
import { Prisma } from "@prisma/client";
import { MONEY_TOLERANCE } from "@/lib/money-tolerance";

const DAY_MS = 86_400_000;
/** 生效多久无已开票发票算超期 (天); 与工作台 no_invoice 待办口径同源 */
export const NO_INVOICE_DAYS = 30;
/** 偏差检查的最小已开票金额 (元) */
export const GAP_MIN_INVOICED = 10_000;
/** 偏差检查的回款缺口比例阈值 */
export const GAP_RATIO = 0.2;
/** 最新发票开具超过多少天才算偏差 (天) */
export const GAP_MIN_INVOICE_AGE_DAYS = 30;

/** 判定 A: 超期未开票 */
export function isNoInvoiceOverdue(
  contract: { status: string; startDate: Date },
  hasIssuedInvoice: boolean,
  now: Date
): boolean {
  if (contract.status !== "ACTIVE") return false;
  if (hasIssuedInvoice) return false;
  return contract.startDate.getTime() <= now.getTime() - NO_INVOICE_DAYS * DAY_MS;
}

export type GapCheckInput = {
  status: string;
  invoicedAmount: Prisma.Decimal | number | string;
  paidAmount: Prisma.Decimal | number | string;
  /** 最新已开票发票的 actualIssueDate; 无已开票发票时 null */
  latestInvoiceDate: Date | null;
};

/** 判定 B: 开票-回款偏差 (金额走 Decimal + MONEY_TOLERANCE, 与项目金额口径一致) */
export function isInvoicePaymentGap(input: GapCheckInput, now: Date): boolean {
  if (input.status !== "ACTIVE") return false;
  if (!input.latestInvoiceDate) return false;
  const invoiced = new Prisma.Decimal(input.invoicedAmount.toString());
  if (invoiced.lessThan(new Prisma.Decimal(GAP_MIN_INVOICED).minus(MONEY_TOLERANCE))) return false;
  const paid = new Prisma.Decimal(input.paidAmount.toString());
  const gap = invoiced.minus(paid);
  if (gap.lessThanOrEqualTo(MONEY_TOLERANCE)) return false;
  // gap/invoiced > 20%
  if (!gap.div(invoiced).greaterThan(GAP_RATIO)) return false;
  return input.latestInvoiceDate.getTime() <= now.getTime() - GAP_MIN_INVOICE_AGE_DAYS * DAY_MS;
}
