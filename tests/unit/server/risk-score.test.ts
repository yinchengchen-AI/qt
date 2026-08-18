// 风险评分五维度分段函数边界单测 (spec §5.1 / §5.2, 计划 Task 2)
// 纯函数不触库, 全部用构造输入验证分段与等级映射
import { describe, it, expect } from "vitest";
import {
  expiryScore,
  progressScore,
  timeProgress,
  amountRatio,
  customerCreditScore,
  amountAnomalyScore,
  riskLevel,
  computeRiskScore,
  RISK_LEVEL_ORDER,
  type RiskScoreInput
} from "@/server/services/contract/risk-score";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-08-18T06:00:00.000Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY_MS);
}

describe("expiryScore 到期风险", () => {
  it("未到期 d<=0 得 0 分", () => {
    expect(expiryScore(new Date(NOW.getTime() + DAY_MS), NOW).score).toBe(0);
    expect(expiryScore(NOW, NOW).score).toBe(0);
  });
  it("逾期 1 天 ≈ 3.33 分", () => {
    const { score, daysOverdue } = expiryScore(daysAgo(1), NOW);
    expect(daysOverdue).toBe(1);
    expect(score).toBeCloseTo(100 / 30, 5);
  });
  it("逾期 30 天 = 100 分", () => {
    expect(expiryScore(daysAgo(30), NOW).score).toBe(100);
  });
  it("逾期 60 天封顶 100 分", () => {
    expect(expiryScore(daysAgo(60), NOW).score).toBe(100);
  });
});

describe("progressScore 进度落后", () => {
  it("t=0 (未开始) 得 0 分", () => {
    expect(progressScore(0, 0)).toBe(0);
  });
  it("业务进度超前 (r>t) 得 0 分", () => {
    expect(progressScore(0.3, 0.8)).toBe(0);
  });
  it("落后 50 个百分点 = 100 分", () => {
    expect(progressScore(1, 0.5)).toBe(100);
  });
  it("落后 20 个百分点 = 40 分", () => {
    expect(progressScore(0.9, 0.7)).toBeCloseTo(40, 5);
  });
  it("落后超过 50 个百分点封顶 100", () => {
    expect(progressScore(1, 0.1)).toBe(100);
  });
});

describe("timeProgress 时间进度", () => {
  it("未开始合同 clamp 到 0", () => {
    expect(timeProgress(new Date(NOW.getTime() + DAY_MS), new Date(NOW.getTime() + 100 * DAY_MS), NOW)).toBe(0);
  });
  it("中途 = 0.5", () => {
    expect(timeProgress(daysAgo(50), new Date(NOW.getTime() + 50 * DAY_MS), NOW)).toBeCloseTo(0.5, 5);
  });
  it("已超过 endDate clamp 到 1", () => {
    expect(timeProgress(daysAgo(120), daysAgo(20), NOW)).toBe(1);
  });
  it("startDate >= endDate 脏数据按 1 天防除零", () => {
    const v = timeProgress(daysAgo(10), daysAgo(10), NOW);
    expect(Number.isFinite(v)).toBe(true);
    expect(v).toBe(1); // elapsed=10d, total=1d → clamp 1
  });
});

describe("amountRatio 金额进度比", () => {
  it("无价合同 (total<=0) 按 1 处理不产生进度风险", () => {
    expect(amountRatio(0, 0)).toBe(1);
    expect(amountRatio(0, 0.01)).toBeCloseTo(0, 5);
  });
  it("正常比率", () => {
    expect(amountRatio(60000, 100000)).toBeCloseTo(0.6, 5);
  });
});

describe("customerCreditScore 客户信用", () => {
  it("样本 < 3 份固定 20 分", () => {
    expect(customerCreditScore(0, 0)).toBe(20);
    expect(customerCreditScore(2, 2)).toBe(20);
  });
  it("6 份合同 2 份强关 = 33.33 分", () => {
    expect(customerCreditScore(6, 2)).toBeCloseTo(100 / 3, 2);
  });
  it("3 份合同 0 强关 = 0 分", () => {
    expect(customerCreditScore(3, 0)).toBe(0);
  });
});

describe("amountAnomalyScore 金额异常", () => {
  it("样本 < 3 份得 0 分", () => {
    expect(amountAnomalyScore(1000000, 10000, 2)).toBe(0);
  });
  it("均值为 null / 0 得 0 分", () => {
    expect(amountAnomalyScore(1000000, null, 5)).toBe(0);
    expect(amountAnomalyScore(1000000, 0, 5)).toBe(0);
  });
  it("偏离 ≤50% 得 0 分", () => {
    expect(amountAnomalyScore(15000, 10000, 3)).toBe(0); // r=0.5
  });
  it("偏离 ≥200% 得 100 分", () => {
    expect(amountAnomalyScore(30000, 10000, 3)).toBe(100); // r=2
  });
  it("偏离 125% 线性得 50 分", () => {
    expect(amountAnomalyScore(22500, 10000, 3)).toBeCloseTo(50, 5); // r=1.25 → (0.75/1.5)*100
  });
});

describe("riskLevel 等级映射", () => {
  it.each([
    [0, "LOW"], [30, "LOW"],
    [31, "MEDIUM"], [60, "MEDIUM"],
    [61, "HIGH"], [80, "HIGH"],
    [81, "CRITICAL"], [100, "CRITICAL"]
  ] as const)("%d 分 → %s", (score, level) => {
    expect(riskLevel(score)).toBe(level);
  });
  it("等级序递增", () => {
    expect(RISK_LEVEL_ORDER.LOW).toBeLessThan(RISK_LEVEL_ORDER.MEDIUM);
    expect(RISK_LEVEL_ORDER.MEDIUM).toBeLessThan(RISK_LEVEL_ORDER.HIGH);
    expect(RISK_LEVEL_ORDER.HIGH).toBeLessThan(RISK_LEVEL_ORDER.CRITICAL);
  });
});

describe("computeRiskScore 加权总分 (spec §7.2 验算口径)", () => {
  it("逾期 20 天 + 回款落后 40pp + 开票落后 30pp + 强关率 33% → 57 分 MEDIUM", () => {
    const input: RiskScoreInput = {
      now: NOW,
      startDate: daysAgo(120),
      endDate: daysAgo(20), // 逾期 20 天 → expiry raw 66.67
      totalAmount: 100000,
      paidAmount: 60000,    // t=1.0, p=0.6 → 落后 0.4 → 80
      invoicedAmount: 70000, // t=1.0, i=0.7 → 落后 0.3 → 60
      customerTotalContracts: 6,
      customerForceClosed: 2, // 33.33
      customerAmountMean: null,
      customerPricedContracts: 0 // 样本不足 → 0
    };
    const r = computeRiskScore(input);
    // 66.67*0.30 + 80*0.25 + 60*0.20 + 33.33*0.15 + 0*0.10 = 20+20+12+5 = 57
    expect(r.score).toBe(57);
    expect(r.level).toBe("MEDIUM");
    expect(r.dimensions.expiry.detail).toContain("已逾期 20 天");
  });

  it("全新健康合同 → LOW", () => {
    const r = computeRiskScore({
      now: NOW,
      startDate: daysAgo(10),
      endDate: new Date(NOW.getTime() + 90 * DAY_MS),
      totalAmount: 100000,
      paidAmount: 20000, // t=0.1, p=0.2 超前 → 0
      invoicedAmount: 20000,
      customerTotalContracts: 1, // 样本不足 → 20
      customerForceClosed: 0,
      customerAmountMean: null,
      customerPricedContracts: 0
    });
    // 0*0.30 + 0*0.25 + 0*0.20 + 20*0.15 + 0*0.10 = 3
    expect(r.score).toBe(3);
    expect(r.level).toBe("LOW");
  });

  it("重度逾期 + 零回款零开票 → HIGH", () => {
    const r = computeRiskScore({
      now: NOW,
      startDate: daysAgo(160),
      endDate: daysAgo(60), // d=60 → 封顶 100
      totalAmount: 100000,
      paidAmount: 0,   // t=1 → 100
      invoicedAmount: 0, // 100
      customerTotalContracts: 1, // 20
      customerForceClosed: 0,
      customerAmountMean: null,
      customerPricedContracts: 0
    });
    // 100*0.30 + 100*0.25 + 100*0.20 + 20*0.15 = 30+25+20+3 = 78
    expect(r.score).toBe(78);
    expect(r.level).toBe("HIGH");
  });

  it("重度逾期 + 零进度 + 客户全部强关 → CRITICAL", () => {
    const r = computeRiskScore({
      now: NOW,
      startDate: daysAgo(160),
      endDate: daysAgo(60),
      totalAmount: 100000,
      paidAmount: 0,
      invoicedAmount: 0,
      customerTotalContracts: 3,
      customerForceClosed: 3, // 100
      customerAmountMean: null,
      customerPricedContracts: 0
    });
    // 30+25+20 + 100*0.15 = 75+15 = 90
    expect(r.score).toBe(90);
    expect(r.level).toBe("CRITICAL");
  });
});
