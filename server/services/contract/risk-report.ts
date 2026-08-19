// 规则引擎风险报告构建器 (Phase 4a, spec §7.1 第一层 / §7.2 输出契约)
//
// 纯函数, 无外部依赖 (不触库不读 env): 输入实时评分 (computeContractRisks 结果)
// 与近 30 天快照, 输出结构化风险报告。weightedScore 公式串与 §7.2 示例逐字符对齐,
// 单测锁定 (tests/unit/server/risk-report.test.ts)。
import {
  RISK_WEIGHTS,
  type ContractRisk,
  type RiskDimension,
  type RiskDimensionKey,
  type RiskLevel
} from "@/server/services/contract/risk-score";

export type RiskTrendSummary = {
  days: number;
  from: number;
  to: number;
  mainDriver: RiskDimensionKey;
};

export type RiskReport = {
  contractId: string;
  contractNo: string;
  riskScore: number;
  riskLevel: RiskLevel;
  /** ISO 日期 (yyyy-mm-dd) */
  asOf: string;
  dimensions: Record<RiskDimensionKey, RiskDimension>;
  /** 公式串, 如 "67×0.30 + 80×0.25 + 60×0.20 + 33×0.15 + 0×0.10 = 57.1 → 四舍五入 57" */
  weightedScore: string;
  recommendations: string[];
  /** 快照 < 2 个时为 null (数据积累中, spec §12) */
  trendSummary: RiskTrendSummary | null;
};

export type RiskReportSnapshot = {
  snapshotDate: Date;
  score: number;
  level: string;
  /** 快照 JSON: 五维度 { score, detail } */
  dimensions: unknown;
};

export const RISK_DIMENSION_LABELS: Record<RiskDimensionKey, string> = {
  expiry: "到期风险",
  payment: "付款进度",
  invoicing: "开票进度",
  customerCredit: "客户信用",
  amountAnomaly: "金额异常"
};

const DIMENSION_ORDER: RiskDimensionKey[] = ["expiry", "payment", "invoicing", "customerCredit", "amountAnomaly"];

const round1 = (v: number) => Math.round(v * 10) / 10;
const fmtWan = (v: number) => `¥${Math.round(v).toLocaleString("en-US")}`;

/** weightedScore 公式串: 各维度显示取整, 加权总和按显示值计算显示 1 位小数, 末位四舍五入为总分
 *  (与 spec §7.2 示例逐字符一致: 67×0.30+80×0.25+60×0.20+33×0.15+0×0.10=57.1→四舍五入 57) */
export function formatWeightedScore(dimensionRaw: Record<RiskDimensionKey, number>, score: number): string {
  const terms = DIMENSION_ORDER.map((k) => `${Math.round(dimensionRaw[k])}×${RISK_WEIGHTS[k].toFixed(2)}`);
  const weighted = DIMENSION_ORDER.reduce((sum, k) => sum + Math.round(dimensionRaw[k]) * RISK_WEIGHTS[k], 0);
  return `${terms.join(" + ")} = ${round1(weighted)} → 四舍五入 ${score}`;
}

/** 趋势汇总: from = 窗口最早快照分, to = 当前实时分; mainDriver = 各维度原始分增量最大者 */
export function buildTrendSummary(
  risk: ContractRisk,
  snapshots: RiskReportSnapshot[]
): RiskTrendSummary | null {
  if (snapshots.length < 2) return null;
  const first = snapshots[0]!;
  const firstDims = (first.dimensions ?? {}) as Partial<Record<RiskDimensionKey, { score?: number }>>;
  let mainDriver: RiskDimensionKey = "expiry";
  let maxDelta = -Infinity;
  for (const k of DIMENSION_ORDER) {
    const before = typeof firstDims[k]?.score === "number" ? firstDims[k]!.score! : 0;
    const delta = risk.dimensionRaw[k] - before;
    if (delta > maxDelta) {
      maxDelta = delta;
      mainDriver = k;
    }
  }
  return { days: 30, from: first.score, to: risk.score, mainDriver };
}

/** 建议生成: 原始分 ≥50 的维度按降序取 Top 3, 文案带业务数据; 趋势上升 ≥10 分追加一条 */
export function buildRecommendations(
  risk: ContractRisk,
  trendSummary: RiskTrendSummary | null,
  graceDays: number
): string[] {
  const REC_THRESHOLD = 50;
  const recs: string[] = [];
  const sorted = DIMENSION_ORDER
    .filter((k) => risk.dimensionRaw[k] >= REC_THRESHOLD)
    .sort((a, b) => risk.dimensionRaw[b] - risk.dimensionRaw[a])
    .slice(0, 3);

  for (const k of sorted) {
    switch (k) {
      case "expiry": {
        const left = graceDays - risk.daysOverdue;
        recs.push(
          left > 0
            ? `合同已逾期 ${risk.daysOverdue} 天且在宽限期内：${left} 天后将被系统自动强关，请优先处理`
            : "合同已过宽限期，随时可能被系统自动强关，请立即处理"
        );
        break;
      }
      case "payment": {
        const remaining = Math.max(0, risk.totalAmount - risk.paidAmount);
        recs.push(`付款进度落后最严重：建议立即发起催款（剩余 ${fmtWan(remaining)}）`);
        break;
      }
      case "invoicing": {
        const remaining = Math.max(0, risk.totalAmount - risk.invoicedAmount);
        recs.push(`开票进度落后：请尽快补开发票（缺口 ${fmtWan(remaining)}）`);
        break;
      }
      case "customerCredit":
        recs.push("该客户历史强关率偏高：后续合作建议缩短账期或预付");
        break;
      case "amountAnomaly":
        recs.push("合同金额偏离客户正常区间：建议复核金额");
        break;
    }
  }

  if (trendSummary && trendSummary.to - trendSummary.from >= 10) {
    recs.push(
      `风险评分 30 天内从 ${trendSummary.from} 升至 ${trendSummary.to}，主要由「${RISK_DIMENSION_LABELS[trendSummary.mainDriver]}」驱动，请优先处理`
    );
  }
  if (recs.length === 0) recs.push("暂无高风险维度，保持常规跟进");
  return recs;
}

/** 报告主入口: 实时评分 + 近 30 天快照 → §7.2 契约结构 */
export function buildRiskReport(
  risk: ContractRisk,
  snapshots: RiskReportSnapshot[],
  graceDays: number,
  now = new Date()
): RiskReport {
  const trendSummary = buildTrendSummary(risk, snapshots);
  return {
    contractId: risk.contractId,
    contractNo: risk.contractNo,
    riskScore: risk.score,
    riskLevel: risk.level,
    asOf: now.toISOString().slice(0, 10),
    dimensions: risk.dimensions,
    weightedScore: formatWeightedScore(risk.dimensionRaw, risk.score),
    recommendations: buildRecommendations(risk, trendSummary, graceDays),
    trendSummary
  };
}
