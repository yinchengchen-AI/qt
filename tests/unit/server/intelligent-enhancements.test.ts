// Phase 5 智能增强服务单测
// 纯函数不触库，验证边界行为与修复后的确定性
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  computeEnhancedRiskScore,
  industryRiskScore,
  historicalOverdueScore,
  ENHANCED_RISK_WEIGHTS,
  type EnhancedRiskScoreInput
} from "@/server/services/contract/risk-score-enhanced";
import {
  generateSmartCollectionAdvice,
  type PaymentHabit
} from "@/server/services/smart-collection";
import {
  identifyTrendPattern,
  predictFutureScore,
  type TrendPoint
} from "@/server/services/risk-trend-prediction";
import {
  parseNaturalLanguageQuery,
  toSearchParams
} from "@/server/services/natural-language-search";
import {
  analyzeWorkPattern,
  type UserBehavior
} from "@/server/services/personalized-recommendations";
import { generateLLMReport } from "@/server/services/ai-report-generation";
import { generateLLMCollectionAdvice } from "@/server/services/smart-collection";
import { env } from "@/lib/env";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-08-18T06:00:00.000Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS);
}

function baseEnhancedInput(): EnhancedRiskScoreInput {
  return {
    now: NOW,
    startDate: daysAgo(120),
    endDate: daysAgo(20),
    totalAmount: 100000,
    paidAmount: 60000,
    invoicedAmount: 70000,
    customerTotalContracts: 6,
    customerForceClosed: 2,
    customerAmountMean: null,
    customerPricedContracts: 0
  };
}

describe("risk-score-enhanced 增强风险评分", () => {
  it("权重总和为 1", () => {
    const sum = Object.values(ENHANCED_RISK_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it("行业风险评分是确定性的", () => {
    const a = industryRiskScore("建筑业");
    const b = industryRiskScore("建筑业");
    expect(a.score).toBe(b.score);
    expect(a.level).toBe("HIGH");
    expect(a.score).toBe(85);
  });

  it("未知行业按默认值 MEDIUM 评分", () => {
    const r = industryRiskScore(undefined);
    expect(r.level).toBe("MEDIUM");
    expect(r.score).toBe(50);
  });

  it("历史逾期率评分按逾期率线性计算", () => {
    const r = historicalOverdueScore({
      totalContracts: 10,
      overdueContracts: 2,
      totalOverdueDays: 20
    });
    expect(r.score).toBe(40); // 20% → 40 分
  });

  it("历史合同不足 2 份不评估逾期率", () => {
    const r = historicalOverdueScore({
      totalContracts: 1,
      overdueContracts: 1,
      totalOverdueDays: 10
    });
    expect(r.score).toBe(0);
  });

  it("增强总分包含新维度", () => {
    const input = {
      ...baseEnhancedInput(),
      customerIndustry: "建筑业",
      customerOverdueHistory: {
        totalContracts: 10,
        overdueContracts: 2,
        totalOverdueDays: 20
      },
      contractSeason: "peak" as const
    };
    const r = computeEnhancedRiskScore(input);
    expect(r.score).toBeGreaterThan(0);
    expect(r.level).toBeDefined();
    expect(r.dimensions.industryRisk).toBeDefined();
    expect(r.dimensions.historicalOverdue).toBeDefined();
    expect(r.dimensions.seasonalFactor).toBeDefined();
    expect(r.enhancedDetails.industry.avgOverdueDays).toBe(30);
  });

  it("同输入同输出（可复现）", () => {
    const input = {
      ...baseEnhancedInput(),
      customerIndustry: "制造业",
      customerOverdueHistory: {
        totalContracts: 10,
        overdueContracts: 5,
        totalOverdueDays: 75
      }
    };
    const a = computeEnhancedRiskScore(input);
    const b = computeEnhancedRiskScore(input);
    expect(a.score).toBe(b.score);
  });
});

describe("smart-collection 智能催款", () => {
  it("contractNo 正确传递", () => {
    const habits: PaymentHabit[] = [
      {
        contractId: "c1",
        contractNo: "HT-2026-001",
        customerId: "cust1",
        customerName: "客户 A",
        totalContracts: 5,
        paidOnTimeCount: 3,
        latePaymentCount: 2,
        avgPaymentDays: 12,
        preferredPaymentMethod: "bank_transfer",
        lastPaymentDate: daysAgo(15),
        outstandingAmount: 50000,
        overdueDays: 20
      }
    ];
    const advice = generateSmartCollectionAdvice(habits);
    expect(advice).toHaveLength(1);
    expect(advice[0]?.contractNo).toBe("HT-2026-001");
    expect(advice[0]?.contractId).toBe("c1");
  });
});

describe("risk-trend-prediction 趋势预测", () => {
  it("样本不足时返回 STABLE", () => {
    const r = identifyTrendPattern([{ date: NOW, score: 50, level: "MEDIUM" }]);
    expect(r.pattern).toBe("STABLE");
  });

  it("非法分数返回 STABLE", () => {
    const r = identifyTrendPattern([
      { date: daysAgo(2), score: -10, level: "LOW" },
      { date: NOW, score: 150, level: "CRITICAL" }
    ]);
    expect(r.pattern).toBe("STABLE");
  });

  it("lookbackDays <= 0 返回 STABLE", () => {
    const r = identifyTrendPattern(
      [
        { date: daysAgo(2), score: 50, level: "MEDIUM" },
        { date: NOW, score: 60, level: "MEDIUM" }
      ],
      0
    );
    expect(r.pattern).toBe("STABLE");
  });

  it("daysAhead < 0 返回默认值", () => {
    const r = predictFutureScore(
      [
        { date: daysAgo(2), score: 50, level: "MEDIUM" },
        { date: NOW, score: 60, level: "MEDIUM" }
      ],
      -1
    );
    expect(r.predictedScore).toBe(50);
  });

  it("能识别上升趋势", () => {
    const snapshots: TrendPoint[] = Array.from({ length: 10 }).map((_, i) => ({
      date: new Date(NOW.getTime() - (10 - i) * DAY_MS),
      score: 30 + i * 5,
      level: i > 4 ? "MEDIUM" : "LOW"
    }));
    const r = identifyTrendPattern(snapshots);
    expect(r.pattern).toBe("RISING");
  });
});

describe("natural-language-search 自然语言搜索", () => {
  it("合同类别返回 Contract where 条件", () => {
    const parsed = parseNaturalLanguageQuery("本月大额合同");
    expect(parsed.category).toBe("contract");
    const params = toSearchParams(parsed);
    expect(params.category).toBe("contract");
    expect(params.where).toHaveProperty("startDate");
    expect(params.where).toHaveProperty("totalAmount");
  });

  it("客户类别返回 Customer where 条件", () => {
    const parsed = parseNaturalLanguageQuery("找客户 A 公司");
    expect(parsed.category).toBe("customer");
    const params = toSearchParams(parsed);
    expect(params.category).toBe("customer");
    expect(params.where).toHaveProperty("OR");
  });

  it("发票类别返回 Invoice where 条件", () => {
    const parsed = parseNaturalLanguageQuery("本月发票");
    expect(parsed.category).toBe("invoice");
    const params = toSearchParams(parsed);
    expect(params.category).toBe("invoice");
    expect(params.where).toHaveProperty("applyDate");
  });

  it("回款类别返回 Payment where 条件", () => {
    const parsed = parseNaturalLanguageQuery("本月回款");
    expect(parsed.category).toBe("payment");
    const params = toSearchParams(parsed);
    expect(params.category).toBe("payment");
    expect(params.where).toHaveProperty("receivedAt");
  });
});

describe("personalized-recommendations 个性化推荐", () => {
  it("avgResponseTime 基于工作时长", () => {
    const behavior: UserBehavior = {
      userId: "u1",
      role: "SALES",
      recentActions: [],
      preferences: {
        workingHours: { start: 9, end: 18 },
        preferredCategories: [],
        responsePatterns: {}
      },
      currentTasks: []
    };
    const pattern = analyzeWorkPattern(behavior);
    expect(pattern.avgResponseTime).toBe(9);
  });

  it("无效工作时长回退到 8 小时", () => {
    const behavior: UserBehavior = {
      userId: "u1",
      role: "SALES",
      recentActions: [],
      preferences: {
        workingHours: { start: 18, end: 9 },
        preferredCategories: [],
        responsePatterns: {}
      },
      currentTasks: []
    };
    const pattern = analyzeWorkPattern(behavior);
    expect(pattern.avgResponseTime).toBe(8);
  });
});

describe("LLM 增强服务未配置 key 时明确报错", () => {
  beforeEach(() => {
    vi.spyOn(env, "DEEPSEEK_API_KEY", "get").mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generateLLMReport 未配置 key 抛 503", async () => {
    await expect(
      generateLLMReport({
        contracts: {
          total: 0,
          active: 0,
          completed: 0,
          totalAmount: 0,
          avgAmount: 0,
          topCustomers: [],
          statusDistribution: {}
        },
        invoices: { total: 0, issued: 0, pending: 0, totalAmount: 0, invoiceRate: 0 },
        payments: {
          total: 0,
          confirmed: 0,
          pending: 0,
          totalAmount: 0,
          paymentRate: 0,
          avgPaymentDays: 0
        },
        risks: { highRiskCount: 0, criticalRiskCount: 0, avgRiskScore: 0, topRisks: [] }
      })
    ).rejects.toThrow("AI 报表生成未配置");
  });

  it("generateLLMCollectionAdvice 未配置 key 抛 503", async () => {
    const habit: PaymentHabit = {
      contractId: "c1",
      contractNo: "HT-001",
      customerId: "cust1",
      customerName: "客户",
      totalContracts: 1,
      paidOnTimeCount: 1,
      latePaymentCount: 0,
      avgPaymentDays: 0,
      preferredPaymentMethod: "bank_transfer",
      lastPaymentDate: null,
      outstandingAmount: 0,
      overdueDays: 0
    };
    await expect(generateLLMCollectionAdvice(habit)).rejects.toThrow("AI 催款建议未配置");
  });
});
