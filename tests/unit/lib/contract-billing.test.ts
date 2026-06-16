// 合同开票状态派生工具:覆盖 5 类场景
//   1. 0/0: 全新合同,未开票 → NOT_STARTED
//   2. 部分开票: 0 < invoiced < total → IN_PROGRESS
//   3. 超额开票(含 red-flush 净额): invoiced > total → COMPLETED
//   4. 浮点容差: invoiced == total - 0.005 → COMPLETED
//   5. 负净额: 净额为负(red-flush 反向) → NOT_STARTED
import { describe, it, expect } from "vitest";
import { getBillingStatus } from "@/lib/contract-billing";

describe("getBillingStatus", () => {
  it("returns NOT_STARTED when invoiced is 0 (0/0 case)", () => {
    expect(getBillingStatus(0, 0)).toBe("NOT_STARTED");
  });

  it("returns NOT_STARTED when invoiced is below tolerance (e.g. 0.005)", () => {
    // 容差 0.01:小于等于容差视为未开票,处理 decimal→number 残留
    expect(getBillingStatus(0.005, 1000)).toBe("NOT_STARTED");
  });

  it("returns IN_PROGRESS when invoiced is between tolerance and total", () => {
    expect(getBillingStatus(500, 1000)).toBe("IN_PROGRESS");
  });

  it("returns IN_PROGRESS at total - tolerance - 0.001 (just outside tolerance)", () => {
    // total=100, 阈值=99.99;99.989 < 99.99 → IN_PROGRESS
    expect(getBillingStatus(99.989, 100)).toBe("IN_PROGRESS");
  });

  it("returns COMPLETED when invoiced >= total - tolerance (浮点容差命中)", () => {
    // 99.995 与 100 差 0.005,在 0.01 容差内 → COMPLETED
    expect(getBillingStatus(99.995, 100)).toBe("COMPLETED");
  });

  it("returns COMPLETED when invoiced exactly equals total", () => {
    expect(getBillingStatus(100, 100)).toBe("COMPLETED");
  });

  it("returns COMPLETED when invoiced exceeds total (含 red-flush 净额溢出)", () => {
    // 合同 100 元,开了 100 元正票 + 10 元红字,净额 110 → COMPLETED
    expect(getBillingStatus(110, 100)).toBe("COMPLETED");
  });

  it("returns NOT_STARTED when invoiced is negative (red-flush 净额为负)", () => {
    // 净额为负意味着总开票为负向(冲销大于原票);按 < TOLERANCE 视为未开票
    expect(getBillingStatus(-10, 100)).toBe("NOT_STARTED");
  });

  it("coerces non-numeric / NaN inputs to 0", () => {
    expect(getBillingStatus(Number("abc"), 100)).toBe("NOT_STARTED");
    expect(getBillingStatus(50, Number("xyz"))).toBe("COMPLETED");
  });
});
