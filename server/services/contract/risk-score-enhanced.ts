// 增强版风险评分引擎 (Phase 5 - 智能化增强)
// 基于 Phase 2 五维度评分，新增三个维度：
//   1) 行业风险 (industryRisk) - 基于客户所属行业的历史违约率
//   2) 历史逾期率 (historicalOverdue) - 客户历史合同的逾期比例
//   3) 季节性因素 (seasonalFactor) - 考虑行业淡旺季对付款的影响
//
// 新维度权重: 行业风险 5%, 历史逾期率 5%, 季节性因素 3% (合计 13%)
// 原五维度权重调整: 等比例压缩为原来的 87% (合计 87%)
//
// 安全: 纯函数，不触库；所有输入显式传入
import { computeRiskScore, riskLevel, type RiskDimensionKey, type RiskLevel } from "./risk-score";

// =====================================================
// 增强维度定义
// =====================================================

export type EnhancedDimensionKey = RiskDimensionKey | "industryRisk" | "historicalOverdue" | "seasonalFactor";

// 行业风险等级 (基于行业历史违约率)
export type IndustryRiskLevel = "LOW" | "MEDIUM" | "HIGH";

// 行业违约率数据 (实际应用中可从外部数据源或配置表加载)
const INDUSTRY_DEFAULT_RISK: Record<string, { defaultLevel: IndustryRiskLevel; avgOverdueDays: number }> = {
  // 安全技术服务行业
  "安全技术服务": { defaultLevel: "LOW", avgOverdueDays: 5 },
  "信息技术": { defaultLevel: "LOW", avgOverdueDays: 7 },
  "制造业": { defaultLevel: "MEDIUM", avgOverdueDays: 15 },
  "建筑业": { defaultLevel: "HIGH", avgOverdueDays: 30 },
  "批发零售": { defaultLevel: "MEDIUM", avgOverdueDays: 20 },
  "房地产": { defaultLevel: "HIGH", avgOverdueDays: 45 },
  "金融业": { defaultLevel: "LOW", avgOverdueDays: 3 },
  // 默认行业
  "其他": { defaultLevel: "MEDIUM", avgOverdueDays: 15 }
};

// 季节性因素权重 (季度 → 调整系数)
// 正数表示风险增加，负数表示风险降低
const SEASONAL_FACTORS: Record<number, number> = {
  1: 0.1,   // Q1: 年后开工，付款较慢
  2: -0.05, // Q2: 正常
  3: 0.05,  // Q3: 业务旺季，可能延迟付款
  4: 0.15   // Q4: 年底催款期，风险较高
};

// =====================================================
// 增强输入类型
// =====================================================

export type EnhancedRiskScoreInput = {
  // 原五维度输入 (从 RiskScoreInput 继承)
  now: Date;
  startDate: Date;
  endDate: Date;
  totalAmount: number;
  paidAmount: number;
  invoicedAmount: number;
  customerTotalContracts: number;
  customerForceClosed: number;
  customerAmountMean: number | null;
  customerPricedContracts: number;
  
  // 新增维度输入
  customerIndustry?: string;  // 客户所属行业
  customerOverdueHistory?: {  // 客户历史逾期数据
    totalContracts: number;
    overdueContracts: number;
    totalOverdueDays: number;
  };
  contractSeason?: "peak" | "off_peak" | "normal"; // 合同所属季节类型
};

// =====================================================
// 增强维度计算函数
// =====================================================

/**
 * 行业风险评分: 基于客户所属行业的历史违约率
 *  LOW (0-30): 低风险行业
 *  MEDIUM (31-60): 中等风险行业
 *  HIGH (61-100): 高风险行业
 */
export function industryRiskScore(
  industry: string | undefined,
  industryData?: Record<string, { defaultLevel: IndustryRiskLevel; avgOverdueDays: number }>
): { score: number; level: IndustryRiskLevel; detail: string } {
  const data = industryData ?? INDUSTRY_DEFAULT_RISK;
  const industryInfo = data[industry ?? "其他"] ?? data["其他"] ?? { defaultLevel: "MEDIUM" as IndustryRiskLevel, avgOverdueDays: 15 };
  
  // 确定性评分：同级别内固定中点，保证同输入同输出，可审计、可测试
  const scoreByLevel: Record<IndustryRiskLevel, number> = {
    LOW: 20,
    MEDIUM: 50,
    HIGH: 85
  };
  const score = scoreByLevel[industryInfo.defaultLevel] ?? 50;
  
  return {
    score,
    level: industryInfo.defaultLevel,
    detail: `行业「${industry ?? "未知"}」历史平均逾期 ${industryInfo.avgOverdueDays} 天，风险等级 ${industryInfo.defaultLevel === "HIGH" ? "高" : industryInfo.defaultLevel === "MEDIUM" ? "中" : "低"}`
  };
}

/**
 * 历史逾期率评分: 基于客户历史合同的逾期比例
 *  无逾期: 0 分
 *  逾期率 0-20%: 0-40 分
 *  逾期率 20-50%: 40-80 分
 *  逾期率 >50%: 80-100 分
 */
export function historicalOverdueScore(
  history?: { totalContracts: number; overdueContracts: number; totalOverdueDays: number }
): { score: number; detail: string } {
  if (!history || history.totalContracts < 2) {
    return { score: 0, detail: "历史合同不足，不评估逾期率" };
  }
  
  const overdueRate = history.overdueContracts / history.totalContracts;
  let score: number;
  
  if (overdueRate <= 0.2) {
    score = overdueRate * 200; // 0-40
  } else if (overdueRate <= 0.5) {
    score = 40 + (overdueRate - 0.2) * (40 / 0.3); // 40-80
  } else {
    score = 80 + Math.min(20, (overdueRate - 0.5) * 40); // 80-100
  }
  
  const avgOverdueDays = history.overdueContracts > 0 
    ? Math.round(history.totalOverdueDays / history.overdueContracts) 
    : 0;
  
  return {
    score: Math.round(score),
    detail: `客户 ${history.totalContracts} 份历史合同中 ${history.overdueContracts} 份逾期（${Math.round(overdueRate * 100)}%），平均逾期 ${avgOverdueDays} 天`
  };
}

/**
 * 季节性因素评分: 考虑行业淡旺季对付款的影响
 *  peak (旺季): 风险增加 (+10-20)
 *  off_peak (淡季): 风险降低 (-5-15)
 *  normal (正常): 微调 (±5)
 */
export function seasonalFactorScore(
  now: Date,
  contractSeason?: "peak" | "off_peak" | "normal"
): { score: number; season: string; adjustment: number } {
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const baseAdjustment = SEASONAL_FACTORS[quarter] ?? 0;
  
  let adjustment: number;
  let seasonLabel: string;
  
  if (contractSeason === "peak") {
    adjustment = Math.max(0.05, baseAdjustment + 0.1);
    seasonLabel = "旺季";
  } else if (contractSeason === "off_peak") {
    adjustment = Math.min(-0.05, baseAdjustment - 0.1);
    seasonLabel = "淡季";
  } else {
    adjustment = baseAdjustment;
    seasonLabel = quarter === 1 ? "Q1开工季" : quarter === 2 ? "Q2正常期" : quarter === 3 ? "Q3业务旺季" : "Q4年底冲刺";
  }
  
  // 转换为风险分 (0-100)
  // 正调整 → 风险增加 (50-100)
  // 负调整 → 风险降低 (0-50)
  const score = Math.round(50 + adjustment * 100);
  
  return {
    score: Math.max(0, Math.min(100, score)),
    season: seasonLabel,
    adjustment: Math.round(adjustment * 100)
  };
}

// =====================================================
// 增强风险评分计算
// =====================================================

// 增强维度权重
export const ENHANCED_RISK_WEIGHTS: Record<EnhancedDimensionKey, number> = {
  expiry: 0.26,           // 30% * 0.87
  payment: 0.22,          // 25% * 0.87
  invoicing: 0.17,        // 20% * 0.87
  customerCredit: 0.13,   // 15% * 0.87
  amountAnomaly: 0.09,    // 10% * 0.87
  industryRisk: 0.05,     // 新增: 5%
  historicalOverdue: 0.05, // 新增: 5%
  seasonalFactor: 0.03    // 新增: 3%
};

export type EnhancedRiskDimension = { score: number; detail: string };

export type EnhancedRiskScoreResult = {
  score: number;
  level: RiskLevel;
  dimensions: Record<EnhancedDimensionKey, EnhancedRiskDimension>;
  dimensionRaw: Record<EnhancedDimensionKey, number>;
  /** 新增维度的详细数据 */
  enhancedDetails: {
    industry: { level: IndustryRiskLevel; avgOverdueDays: number };
    overdueHistory: { rate: number; avgDays: number };
    season: { name: string; adjustment: number };
  };
};

/**
 * 计算增强版风险评分
 * 在原五维度基础上，新增三个维度
 */
export function computeEnhancedRiskScore(input: EnhancedRiskScoreInput): EnhancedRiskScoreResult {
  // 1. 计算原五维度 (复用 risk-score.ts 逻辑)
  const baseResult = computeBaseRiskScore(input);
  
  // 2. 计算新增维度
  const industryResult = industryRiskScore(input.customerIndustry);
  const industryInfo =
    INDUSTRY_DEFAULT_RISK[input.customerIndustry ?? "其他"] ??
    INDUSTRY_DEFAULT_RISK["其他"] ?? { defaultLevel: "MEDIUM" as IndustryRiskLevel, avgOverdueDays: 15 };
  const overdueResult = historicalOverdueScore(input.customerOverdueHistory);
  const seasonalResult = seasonalFactorScore(input.now, input.contractSeason);
  
  // 3. 按新权重计算总分
  const weighted =
    baseResult.dimensionRaw.expiry * ENHANCED_RISK_WEIGHTS.expiry +
    baseResult.dimensionRaw.payment * ENHANCED_RISK_WEIGHTS.payment +
    baseResult.dimensionRaw.invoicing * ENHANCED_RISK_WEIGHTS.invoicing +
    baseResult.dimensionRaw.customerCredit * ENHANCED_RISK_WEIGHTS.customerCredit +
    baseResult.dimensionRaw.amountAnomaly * ENHANCED_RISK_WEIGHTS.amountAnomaly +
    industryResult.score * ENHANCED_RISK_WEIGHTS.industryRisk +
    overdueResult.score * ENHANCED_RISK_WEIGHTS.historicalOverdue +
    seasonalResult.score * ENHANCED_RISK_WEIGHTS.seasonalFactor;
  
  const score = Math.round(weighted);
  
  // 4. 合并维度数据
  const dimensionRaw: Record<EnhancedDimensionKey, number> = {
    ...baseResult.dimensionRaw,
    industryRisk: industryResult.score,
    historicalOverdue: overdueResult.score,
    seasonalFactor: seasonalResult.score
  };
  
  const dimensions: Record<EnhancedDimensionKey, EnhancedRiskDimension> = {
    ...baseResult.dimensions,
    industryRisk: { score: industryResult.score, detail: industryResult.detail },
    historicalOverdue: { score: overdueResult.score, detail: overdueResult.detail },
    seasonalFactor: { score: seasonalResult.score, detail: `当前${seasonalResult.season}，季节性调整 ${seasonalResult.adjustment > 0 ? "+" : ""}${seasonalResult.adjustment}%` }
  };
  
  // 5. 计算客户历史逾期率
  const overdueHistory = input.customerOverdueHistory;
  const overdueRate = overdueHistory && overdueHistory.totalContracts > 0
    ? Math.round((overdueHistory.overdueContracts / overdueHistory.totalContracts) * 100)
    : 0;
  const avgOverdueDays = overdueHistory && overdueHistory.overdueContracts > 0
    ? Math.round(overdueHistory.totalOverdueDays / overdueHistory.overdueContracts)
    : 0;
  
  return {
    score,
    level: riskLevel(score),
    dimensions,
    dimensionRaw,
    enhancedDetails: {
      industry: {
        level: industryResult.level,
        avgOverdueDays: industryInfo.avgOverdueDays
      },
      overdueHistory: { rate: overdueRate, avgDays: avgOverdueDays },
      season: { name: seasonalResult.season, adjustment: seasonalResult.adjustment }
    }
  };
}

// =====================================================
// 辅助函数 (复用 risk-score.ts 逻辑)
// =====================================================

/** 复用 risk-score.ts 的原五维度计算 */
function computeBaseRiskScore(input: EnhancedRiskScoreInput) {
  return computeRiskScore(input);
}
