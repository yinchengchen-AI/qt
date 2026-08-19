// 风险报告构建器单测 (Phase 4a, spec §7.2 输出契约验算)
// 纯函数不触库, 手工构造 ContractRisk / 快照验证公式串 / mainDriver / 建议
import { describe, it, expect } from "vitest";
import {
  formatWeightedScore,
  buildTrendSummary,
  buildRecommendations,
  buildRiskReport,
  type RiskReportSnapshot
} from "@/server/services/contract/risk-report";
import type { ContractRisk, RiskDimensionKey } from "@/server/services/contract/risk-score";

const DAY_MS = 86_400_000;
const NOW = new Date("2026-08-18T06:00:00.000Z");
const GRACE_DAYS = 90;

/** §7.2 示例合同: 逾期 20 天 + 回款落后 40pp + 开票落后 30pp + 强关率 33% → 57 MEDIUM */
function makeRisk(overrides: Partial<ContractRisk> = {}): ContractRisk {
  return {
    score: 57,
    level: "MEDIUM",
    dimensionRaw: { expiry: 66.6667, payment: 80, invoicing: 60, customerCredit: 33.3333, amountAnomaly: 0 },
    dimensions: {
      expiry: { score: 66.7, detail: "已逾期 20 天" },
      payment: { score: 80, detail: "时间进度 100%，回款进度 60%" },
      invoicing: { score: 60, detail: "时间进度 100%，开票进度 70%" },
      customerCredit: { score: 33.3, detail: "客户 6 份合同中 2 份被强关（33.3%）" },
      amountAnomaly: { score: 0, detail: "客户合同样本不足，不评估金额偏离" }
    },
    contractId: "c1",
    contractNo: "QT-2026-001",
    customerName: "测试客户",
    title: "测试合同",
    ownerUserId: "u1",
    endDate: new Date(NOW.getTime() - 20 * DAY_MS),
    totalAmount: 100000,
    paidAmount: 60000,
    invoicedAmount: 70000,
    daysOverdue: 20,
    ...overrides
  };
}

function makeSnapshot(daysAgo: number, score: number, dims: Partial<Record<RiskDimensionKey, number>>): RiskReportSnapshot {
  const dimensions = Object.fromEntries(
    Object.entries(dims).map(([k, v]) => [k, { score: v, detail: "" }])
  );
  return { snapshotDate: new Date(NOW.getTime() - daysAgo * DAY_MS), score, level: "LOW", dimensions };
}

describe("formatWeightedScore (spec §7.2 逐字符验算)", () => {
  it("示例公式: 67×0.30 + 80×0.25 + 60×0.20 + 33×0.15 + 0×0.10 = 57.1 → 四舍五入 57", () => {
    const risk = makeRisk();
    expect(formatWeightedScore(risk.dimensionRaw, risk.score)).toBe(
      "67×0.30 + 80×0.25 + 60×0.20 + 33×0.15 + 0×0.10 = 57.1 → 四舍五入 57"
    );
  });
});

describe("buildTrendSummary", () => {
  it("快照 < 2 个 → null (数据积累中)", () => {
    expect(buildTrendSummary(makeRisk(), [])).toBeNull();
    expect(buildTrendSummary(makeRisk(), [makeSnapshot(1, 50, {})])).toBeNull();
  });

  it("from = 最早快照分, to = 当前实时分, mainDriver = 维度增量最大者", () => {
    const risk = makeRisk();
    const snapshots = [
      makeSnapshot(20, 35, { expiry: 30, payment: 60, invoicing: 50, customerCredit: 33.3, amountAnomaly: 0 }),
      makeSnapshot(5, 48, { expiry: 50, payment: 70, invoicing: 55, customerCredit: 33.3, amountAnomaly: 0 })
    ];
    const t = buildTrendSummary(risk, snapshots);
    expect(t).not.toBeNull();
    expect(t!.days).toBe(30);
    expect(t!.from).toBe(35);
    expect(t!.to).toBe(57);
    // expiry: 66.67-30=36.67 增量最大 → mainDriver=expiry (与 §7.2 示例一致)
    expect(t!.mainDriver).toBe("expiry");
  });

  it("付款维度增量更大时 mainDriver=payment", () => {
    const risk = makeRisk();
    const snapshots = [
      makeSnapshot(20, 30, { expiry: 66.7, payment: 0, invoicing: 60, customerCredit: 33.3, amountAnomaly: 0 })
    ];
    // 只有 1 个快照 → null; 再加一个
    const two = [...snapshots, makeSnapshot(3, 50, { expiry: 66.7, payment: 40, invoicing: 60, customerCredit: 33.3, amountAnomaly: 0 })];
    const t = buildTrendSummary(risk, two);
    expect(t!.mainDriver).toBe("payment"); // 80-0=80 > 66.7-66.7=0
  });
});

describe("buildRecommendations", () => {
  it("§7.2 示例: 催款带剩余金额 + 逾期带宽限期倒数 + 客户信用", () => {
    const risk = makeRisk();
    const recs = buildRecommendations(risk, null, GRACE_DAYS);
    // payment 80 最高 → 第一条; expiry 66.7 第二; invoicing 60 第三 (Top 3)
    expect(recs[0]).toBe("付款进度落后最严重：建议立即发起催款（剩余 ¥40,000）");
    expect(recs[1]).toBe("合同已逾期 20 天且在宽限期内：70 天后将被系统自动强关，请优先处理");
    expect(recs[2]).toBe("开票进度落后：请尽快补开发票（缺口 ¥30,000）");
  });

  it("客户信用 ≥50 时给缩短账期建议", () => {
    const risk = makeRisk({ dimensionRaw: { expiry: 0, payment: 0, invoicing: 0, customerCredit: 80, amountAnomaly: 0 } });
    const recs = buildRecommendations(risk, null, GRACE_DAYS);
    expect(recs).toEqual(["该客户历史强关率偏高：后续合作建议缩短账期或预付"]);
  });

  it("趋势上升 ≥10 分追加趋势建议", () => {
    const risk = makeRisk();
    const trend = { days: 30, from: 35, to: 57, mainDriver: "expiry" as const };
    const recs = buildRecommendations(risk, trend, GRACE_DAYS);
    expect(recs[recs.length - 1]).toBe("风险评分 30 天内从 35 升至 57，主要由「到期风险」驱动，请优先处理");
  });

  it("全部维度 <50 → 常规跟进建议", () => {
    const risk = makeRisk({ dimensionRaw: { expiry: 0, payment: 10, invoicing: 10, customerCredit: 20, amountAnomaly: 0 }, score: 5, level: "LOW" });
    const recs = buildRecommendations(risk, null, GRACE_DAYS);
    expect(recs).toEqual(["暂无高风险维度，保持常规跟进"]);
  });

  it("超过宽限期 → 立即处理文案", () => {
    const risk = makeRisk({ daysOverdue: 95, dimensionRaw: { expiry: 100, payment: 0, invoicing: 0, customerCredit: 0, amountAnomaly: 0 } });
    const recs = buildRecommendations(risk, null, GRACE_DAYS);
    expect(recs[0]).toBe("合同已过宽限期，随时可能被系统自动强关，请立即处理");
  });
});

describe("buildRiskReport 整体契约", () => {
  it("输出 §7.2 结构: asOf / weightedScore / recommendations / trendSummary", () => {
    const risk = makeRisk();
    const snapshots = [
      makeSnapshot(20, 35, { expiry: 30, payment: 60, invoicing: 50, customerCredit: 33.3, amountAnomaly: 0 }),
      makeSnapshot(5, 48, { expiry: 50, payment: 70, invoicing: 55, customerCredit: 33.3, amountAnomaly: 0 })
    ];
    const report = buildRiskReport(risk, snapshots, GRACE_DAYS, NOW);
    expect(report.contractId).toBe("c1");
    expect(report.riskScore).toBe(57);
    expect(report.riskLevel).toBe("MEDIUM");
    expect(report.asOf).toBe("2026-08-18");
    expect(report.weightedScore).toBe("67×0.30 + 80×0.25 + 60×0.20 + 33×0.15 + 0×0.10 = 57.1 → 四舍五入 57");
    expect(report.recommendations.length).toBe(4); // Top 3 + 趋势
    expect(report.trendSummary).toEqual({ days: 30, from: 35, to: 57, mainDriver: "expiry" });
    expect(report.dimensions.expiry.detail).toContain("已逾期 20 天");
  });
});
