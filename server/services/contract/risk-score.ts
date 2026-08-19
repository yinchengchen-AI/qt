// 合同风险评分引擎 (Phase 2)
// spec: docs/superpowers/specs/2026-08-18-contract-deepening-roadmap-design.md §5.1
//
// 五维度原始分 0-100, 加权求总分 (满分 100), Math.round 后映射等级:
//   到期风险 30% | 付款进度 25% | 开票进度 20% | 客户信用 15% | 金额异常 10%
//
// 批量入口 computeContractRisks 必须预聚合 (payment/invoice/客户历史各一次查询),
// 禁止循环内单查 (N+1)。纯函数部分 (computeRiskScore 等) 不触库, 供单测与实时计算复用。
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { INVOICE_ISSUED_AMOUNT_STATUSES } from "@/lib/invoice-amounts";

const DAY_MS = 86_400_000;

export type RiskDimensionKey = "expiry" | "payment" | "invoicing" | "customerCredit" | "amountAnomaly";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** 等级序, 升档检测用 (今日序 > 昨日序 且达 HIGH/CRITICAL 才发消息) */
export const RISK_LEVEL_ORDER: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

export const RISK_WEIGHTS: Record<RiskDimensionKey, number> = {
  expiry: 0.30,
  payment: 0.25,
  invoicing: 0.20,
  customerCredit: 0.15,
  amountAnomaly: 0.10
};

export type RiskDimension = { score: number; detail: string };

export type RiskScoreResult = {
  score: number;
  level: RiskLevel;
  dimensions: Record<RiskDimensionKey, RiskDimension>;
  /** 各维度未取整原始分 (weightedScore 公式串验算用, spec §7.2); 不落快照 JSON */
  dimensionRaw: Record<RiskDimensionKey, number>;
};

export type RiskScoreInput = {
  now: Date;
  startDate: Date;
  endDate: Date;
  totalAmount: number;
  /** 已确认回款 (Payment CONFIRMED+RECONCILED 口径) */
  paidAmount: number;
  /** 已开票 (INVOICE_ISSUED_AMOUNT_STATUSES 口径) */
  invoicedAmount: number;
  /** 客户全部非删除合同数 (含本合同) */
  customerTotalContracts: number;
  /** 其中 CLOSED 且 reviewComment="overdue_terminated" 的份数 */
  customerForceClosed: number;
  /** 客户 totalAmount>0 合同的金额均值; 无有效样本时 null */
  customerAmountMean: number | null;
  /** 客户 totalAmount>0 合同份数 (金额异常维度的样本量) */
  customerPricedContracts: number;
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** 到期风险: d=逾期天数 (未到期 d<=0 得 0), 30 天逾期=满分 */
export function expiryScore(endDate: Date, now: Date): { score: number; daysOverdue: number } {
  const daysOverdue = Math.floor((now.getTime() - endDate.getTime()) / DAY_MS);
  if (daysOverdue <= 0) return { score: 0, daysOverdue: 0 };
  return { score: Math.min(100, (daysOverdue / 30) * 100), daysOverdue };
}

/** 进度落后: t=时间进度(0-1), r=业务进度(回款或开票比); 落后 50 个百分点=满分, 超前不得分 */
export function progressScore(t: number, r: number): number {
  return Math.min(100, (Math.max(0, t - r) / 0.5) * 100);
}

/** 时间进度: 已过天数/合同总天数, clamp 0-1; totalDays<=0 脏数据按 1 天防除零 */
export function timeProgress(startDate: Date, endDate: Date, now: Date): number {
  const total = Math.max(1, endDate.getTime() - startDate.getTime());
  return clamp01((now.getTime() - startDate.getTime()) / total);
}

/** 金额进度比: 无价合同 (totalAmount<=0) 不产生进度风险, 按 1 处理 */
export function amountRatio(amount: number, total: number): number {
  if (total <= 0) return 1;
  return amount / total;
}

/** 客户信用: 强关率*100; 样本<3 份固定 20 分 (防小样本极端) */
export function customerCreditScore(totalContracts: number, forceClosed: number): number {
  if (totalContracts < 3) return 20;
  return (forceClosed / totalContracts) * 100;
}

/** 金额异常: 偏离均值 ≤50% 得 0, ≥200% 得 100, 中间线性; 样本<3 或无均值得 0 */
export function amountAnomalyScore(amount: number, mean: number | null, pricedCount: number): number {
  if (pricedCount < 3 || mean === null || mean <= 0) return 0;
  const r = Math.abs(amount - mean) / mean;
  if (r <= 0.5) return 0;
  if (r >= 2) return 100;
  return ((r - 0.5) / 1.5) * 100;
}

export function riskLevel(score: number): RiskLevel {
  if (score <= 30) return "LOW";
  if (score <= 60) return "MEDIUM";
  if (score <= 80) return "HIGH";
  return "CRITICAL";
}

/** 五维度加权总分; 纯函数, 不触库 */
export function computeRiskScore(input: RiskScoreInput): RiskScoreResult {
  const t = timeProgress(input.startDate, input.endDate, input.now);
  const expiry = expiryScore(input.endDate, input.now);
  const paymentRatio = amountRatio(input.paidAmount, input.totalAmount);
  const invoiceRatio = amountRatio(input.invoicedAmount, input.totalAmount);
  const payment = progressScore(t, paymentRatio);
  const invoicing = progressScore(t, invoiceRatio);
  const credit = customerCreditScore(input.customerTotalContracts, input.customerForceClosed);
  const anomaly = amountAnomalyScore(input.totalAmount, input.customerAmountMean, input.customerPricedContracts);

  const weighted =
    expiry.score * RISK_WEIGHTS.expiry +
    payment * RISK_WEIGHTS.payment +
    invoicing * RISK_WEIGHTS.invoicing +
    credit * RISK_WEIGHTS.customerCredit +
    anomaly * RISK_WEIGHTS.amountAnomaly;
  const score = Math.round(weighted);

  return {
    score,
    level: riskLevel(score),
    dimensionRaw: {
      expiry: expiry.score,
      payment,
      invoicing,
      customerCredit: credit,
      amountAnomaly: anomaly
    },
    dimensions: {
      expiry: {
        score: round1(expiry.score),
        detail: expiry.daysOverdue > 0 ? `已逾期 ${expiry.daysOverdue} 天` : "未到期"
      },
      payment: {
        score: round1(payment),
        detail: `时间进度 ${round1(t * 100)}%，回款进度 ${round1(paymentRatio * 100)}%`
      },
      invoicing: {
        score: round1(invoicing),
        detail: `时间进度 ${round1(t * 100)}%，开票进度 ${round1(invoiceRatio * 100)}%`
      },
      customerCredit: {
        score: round1(credit),
        detail:
          input.customerTotalContracts < 3
            ? `客户历史合同仅 ${input.customerTotalContracts} 份（样本不足按 20 分计）`
            : `客户 ${input.customerTotalContracts} 份合同中 ${input.customerForceClosed} 份被强关（${round1(credit)}%）`
      },
      amountAnomaly: {
        score: round1(anomaly),
        detail:
          input.customerPricedContracts < 3 || input.customerAmountMean === null
            ? "客户合同样本不足，不评估金额偏离"
            : `金额偏离客户均值 ${round1(input.customerAmountMean > 0 ? (Math.abs(input.totalAmount - input.customerAmountMean) / input.customerAmountMean) * 100 : 0)}%`
      }
    }
  };
}

/** 批量计算用的合同行 (仅 ACTIVE 由调用方保证) */
export type ContractRiskRow = {
  id: string;
  contractNo: string;
  customerId: string;
  customerName: string;
  title: string;
  totalAmount: Prisma.Decimal | number | string;
  startDate: Date;
  endDate: Date;
  ownerUserId: string;
};

export type ContractRisk = RiskScoreResult & {
  contractId: string;
  contractNo: string;
  customerName: string;
  title: string;
  ownerUserId: string;
  endDate: Date;
  /** 报告构建器用 (Phase 4a): 合同金额与已确认回款/已开票聚合, 批量查询时已算出, 透出免二次查询 */
  totalAmount: number;
  paidAmount: number;
  invoicedAmount: number;
  /** 逾期天数 (未到期为 0) */
  daysOverdue: number;
};

/**
 * 批量计算合同风险 (预聚合, 禁 N+1):
 *   payment / invoice 各一次 groupBy; 客户历史一次 findMany 后 JS 分组。
 *   客户信用样本 = 该客户全部非删除合同; 金额异常样本 = 其中 totalAmount>0 的合同。
 */
export async function computeContractRisks(
  contracts: ContractRiskRow[],
  now = new Date()
): Promise<ContractRisk[]> {
  if (contracts.length === 0) return [];
  const ids = contracts.map((c) => c.id);
  const customerIds = Array.from(new Set(contracts.map((c) => c.customerId)));

  const [paidAgg, invoicedAgg, customerContracts] = await Promise.all([
    prisma.payment.groupBy({
      by: ["contractId"],
      where: { contractId: { in: ids }, status: { in: ["CONFIRMED", "RECONCILED"] }, deletedAt: null },
      _sum: { amount: true }
    }),
    prisma.invoice.groupBy({
      by: ["contractId"],
      where: { contractId: { in: ids }, status: { in: [...INVOICE_ISSUED_AMOUNT_STATUSES] }, deletedAt: null },
      _sum: { amount: true }
    }),
    prisma.contract.findMany({
      where: { customerId: { in: customerIds }, deletedAt: null },
      select: { customerId: true, totalAmount: true, status: true, reviewComment: true }
    })
  ]);

  const paidByContract = new Map(paidAgg.map((p) => [p.contractId, Number(p._sum.amount ?? 0)]));
  const invoicedByContract = new Map(invoicedAgg.map((i) => [i.contractId, Number(i._sum.amount ?? 0)]));

  const creditByCustomer = new Map<string, { total: number; forceClosed: number; pricedCount: number; mean: number | null }>();
  const contractsByCustomer = new Map<string, typeof customerContracts>();
  for (const cc of customerContracts) {
    const list = contractsByCustomer.get(cc.customerId);
    if (list) list.push(cc);
    else contractsByCustomer.set(cc.customerId, [cc]);
  }
  for (const [customerId, list] of contractsByCustomer) {
    const priced = list.filter((c) => Number(c.totalAmount) > 0).map((c) => Number(c.totalAmount));
    creditByCustomer.set(customerId, {
      total: list.length,
      forceClosed: list.filter((c) => c.status === "CLOSED" && c.reviewComment === "overdue_terminated").length,
      pricedCount: priced.length,
      mean: priced.length > 0 ? priced.reduce((a, b) => a + b, 0) / priced.length : null
    });
  }

  return contracts.map((c) => {
    const credit = creditByCustomer.get(c.customerId) ?? { total: 0, forceClosed: 0, pricedCount: 0, mean: null };
    const paidAmount = paidByContract.get(c.id) ?? 0;
    const invoicedAmount = invoicedByContract.get(c.id) ?? 0;
    const totalAmount = Number(c.totalAmount);
    const result = computeRiskScore({
      now,
      startDate: c.startDate,
      endDate: c.endDate,
      totalAmount,
      paidAmount,
      invoicedAmount,
      customerTotalContracts: credit.total,
      customerForceClosed: credit.forceClosed,
      customerAmountMean: credit.mean,
      customerPricedContracts: credit.pricedCount
    });
    return {
      ...result,
      contractId: c.id,
      contractNo: c.contractNo,
      customerName: c.customerName,
      title: c.title,
      ownerUserId: c.ownerUserId,
      endDate: c.endDate,
      totalAmount,
      paidAmount,
      invoicedAmount,
      daysOverdue: Math.max(0, Math.floor((now.getTime() - c.endDate.getTime()) / DAY_MS))
    };
  });
}
