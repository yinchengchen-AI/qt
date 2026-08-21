// 风险趋势预测服务 (Phase 5 - 智能化增强)
// 算法: 移动平均 + 线性回归
// 安全: 纯函数，不触库
import type { RiskLevel } from "./contract/risk-score";

export type TrendPoint = {
  date: Date;
  score: number;
  level: RiskLevel;
};

export type TrendPattern = "RISING" | "FALLING" | "STABLE" | "VOLATILE";

export type TrendPrediction = {
  contractId: string;
  contractNo: string;
  currentScore: number;
  currentLevel: RiskLevel;
  trend: TrendPattern;
  trendStrength: number;
  predictions: Array<{
    daysAhead: number;
    predictedScore: number;
    predictedLevel: RiskLevel;
    confidence: number;
  }>;
  analysis: {
    summary: string;
    keyFactors: string[];
    recommendation: string;
  };
};

function validateSnapshots(snapshots: TrendPoint[]) {
  if (snapshots.length < 2) return { valid: false, reason: "样本不足" } as const;
  for (const s of snapshots) {
    if (!(s.date instanceof Date) || Number.isNaN(s.date.getTime())) {
      return { valid: false, reason: "包含非法日期" } as const;
    }
    if (!Number.isFinite(s.score) || s.score < 0 || s.score > 100) {
      return { valid: false, reason: "风险分必须在 0-100 之间" } as const;
    }
  }
  return { valid: true, reason: undefined } as const;
}

export function identifyTrendPattern(
  snapshots: TrendPoint[],
  lookbackDays = 30
): { pattern: TrendPattern; strength: number; slope: number } {
  const validation = validateSnapshots(snapshots);
  if (!validation.valid || lookbackDays <= 0) {
    return { pattern: "STABLE", strength: 0, slope: 0 };
  }
  const sorted = [...snapshots].sort((a, b) => a.date.getTime() - b.date.getTime());
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookbackDays);
  const recent = sorted.filter(s => s.date >= cutoff);
  if (recent.length < 2) {
    return { pattern: "STABLE", strength: 0, slope: 0 };
  }
  const n = recent.length;
  const xValues = recent.map((_, i) => i);
  const yValues = recent.map(s => s.score);
  const xMean = xValues.reduce((a, b) => a + b, 0) / n;
  const yMean = yValues.reduce((a, b) => a + b, 0) / n;
  const numerator = xValues.reduce((sum, x, i) => sum + (x - xMean) * ((yValues[i] ?? 0) - yMean), 0);
  const denominator = xValues.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const yVariance = yValues.reduce((sum, y) => sum + (y - yMean) ** 2, 0) / n;
  const yStd = Math.sqrt(yVariance);
  const normalizedSlope = yMean > 0 ? Math.abs(slope) / yMean : 0;
  let pattern: TrendPattern;
  let strength: number;
  if (yStd > 20) {
    pattern = "VOLATILE";
    strength = Math.min(1, yStd / 30);
  } else if (normalizedSlope > 0.05) {
    pattern = slope > 0 ? "RISING" : "FALLING";
    strength = Math.min(1, normalizedSlope * 5);
  } else {
    pattern = "STABLE";
    strength = 0;
  }
  return { pattern, strength, slope };
}

export function predictFutureScore(
  snapshots: TrendPoint[],
  daysAhead: number,
  confidenceDecay = 0.95
): { predictedScore: number; confidence: number } {
  const validation = validateSnapshots(snapshots);
  if (!validation.valid || daysAhead < 0 || confidenceDecay <= 0 || confidenceDecay > 1) {
    return { predictedScore: 50, confidence: 0.3 };
  }
  const sorted = [...snapshots].sort((a, b) => a.date.getTime() - b.date.getTime());
  const n = sorted.length;
  const xValues = sorted.map((_, i) => i);
  const yValues = sorted.map(s => s.score);
  const xMean = xValues.reduce((a, b) => a + b, 0) / n;
  const yMean = yValues.reduce((a, b) => a + b, 0) / n;
  const numerator = xValues.reduce((sum, x, i) => sum + (x - xMean) * ((yValues[i] ?? 0) - yMean), 0);
  const denominator = xValues.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  const futureIndex = n + daysAhead;
  const predictedScore = Math.max(0, Math.min(100, intercept + slope * futureIndex));
  const confidence = Math.pow(confidenceDecay, daysAhead);
  return { predictedScore: Math.round(predictedScore), confidence };
}

function scoreToLevel(score: number): RiskLevel {
  if (score <= 30) return "LOW";
  if (score <= 60) return "MEDIUM";
  if (score <= 80) return "HIGH";
  return "CRITICAL";
}

export function generatePredictions(
  snapshots: TrendPoint[],
  days: number[] = [7, 14, 30]
): TrendPrediction["predictions"] {
  return days.map(daysAhead => {
    const { predictedScore, confidence } = predictFutureScore(snapshots, daysAhead);
    return { daysAhead, predictedScore, predictedLevel: scoreToLevel(predictedScore), confidence };
  });
}

export function generateTrendAnalysis(
  contractNo: string,
  currentScore: number,
  trend: { pattern: TrendPattern; strength: number; slope: number },
  predictions: TrendPrediction["predictions"]
): TrendPrediction["analysis"] {
  const patternLabels: Record<TrendPattern, string> = {
    RISING: "上升",
    FALLING: "下降",
    STABLE: "平稳",
    VOLATILE: "波动"
  };
  const summary = `合同 ${contractNo} 当前风险分 ${currentScore}，趋势${patternLabels[trend.pattern]}，强度 ${Math.round(trend.strength * 100)}%`;
  const keyFactors: string[] = [];
  if (trend.pattern === "RISING") {
    keyFactors.push("风险分持续上升，需重点关注");
    if (trend.slope > 1) keyFactors.push("上升斜率较大，恶化速度快");
  } else if (trend.pattern === "FALLING") {
    keyFactors.push("风险分持续下降，情况改善中");
  } else if (trend.pattern === "VOLATILE") {
    keyFactors.push("风险分波动较大，需稳定跟踪");
  }
  const highPrediction = predictions.find(p => p.predictedLevel === "HIGH" || p.predictedLevel === "CRITICAL");
  if (highPrediction) {
    keyFactors.push(`预计 ${highPrediction.daysAhead} 天内可能升至 ${highPrediction.predictedLevel} 级`);
  }
  let recommendation = "";
  if (trend.pattern === "RISING" && trend.strength > 0.5) {
    recommendation = "风险上升趋势明显，建议立即采取预防措施";
  } else if (trend.pattern === "VOLATILE") {
    recommendation = "风险波动较大，建议增加跟踪频率";
  } else if (trend.pattern === "FALLING") {
    recommendation = "风险下降趋势良好，继续保持现有跟进策略";
  } else {
    recommendation = "风险平稳，维持常规跟踪即可";
  }
  return { summary, keyFactors, recommendation };
}

export function buildTrendPrediction(
  contractId: string,
  contractNo: string,
  currentScore: number,
  snapshots: TrendPoint[]
): TrendPrediction {
  const currentLevel = scoreToLevel(currentScore);
  const trend = identifyTrendPattern(snapshots);
  const predictions = generatePredictions(snapshots);
  const analysis = generateTrendAnalysis(contractNo, currentScore, trend, predictions);
  return {
    contractId,
    contractNo,
    currentScore,
    currentLevel,
    trend: trend.pattern,
    trendStrength: trend.strength,
    predictions,
    analysis
  };
}
