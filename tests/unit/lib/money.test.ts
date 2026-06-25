// 金额计算 + 容差单元测试
// 覆盖: calcTaxBreakdown 入参类型 + 舍入 + 0/100% 边界
//       isOverAmount 默认容差 + 边界判定 (greaterThan 严格大于)
//       MONEY_TOLERANCE 是 Prisma.Decimal("0.01")
import { describe, it, expect } from "vitest";
import { Prisma } from "@prisma/client";
import { calcTaxBreakdown, isOverAmount } from "@/lib/money";
import { MONEY_TOLERANCE } from "@/lib/money-tolerance";

describe("calcTaxBreakdown", () => {
  it("整数 1000 / 0.06 → taxAmount ≈ 56.60, excluding ≈ 943.40", () => {
    const r = calcTaxBreakdown(1000, 0.06);
    expect(r.taxAmount.toNumber()).toBe(56.6);
    expect(r.amountExcludingTax.toNumber()).toBe(943.4);
    expect(r.totalAmount.toNumber()).toBe(1000);
  });

  it("Decimal 内部累计无 JS 浮点漂移: 0.3 rate=0.06 → 0.3 精确", () => {
    // 验证用 Decimal 而不是 number; JS number 算 0.1+0.2 = 0.30000000000000004
    const r = calcTaxBreakdown(0.3, 0.06);
    expect(r.totalAmount.toNumber()).toBe(0.3);
    // taxAmount = 0.3 * 0.06 / 1.06 = 0.0169811... → toDecimalPlaces(2) → 0.02
    expect(r.taxAmount.toNumber()).toBeCloseTo(0.02, 2);
  });

  it("接受 number / string / Prisma.Decimal 三种入参", () => {
    const a = calcTaxBreakdown(100, 0.06);
    const b = calcTaxBreakdown("100", "0.06");
    const c = calcTaxBreakdown(new Prisma.Decimal(100), new Prisma.Decimal(0.06));
    expect(a.taxAmount.toString()).toBe(b.taxAmount.toString());
    expect(b.taxAmount.toString()).toBe(c.taxAmount.toString());
  });

  it("0% 税率 → taxAmount = 0, excluding = total", () => {
    const r = calcTaxBreakdown(1000, 0);
    expect(r.taxAmount.toNumber()).toBe(0);
    expect(r.amountExcludingTax.toNumber()).toBe(1000);
  });

  it("100% 税率 → taxAmount = total/2, excluding = total/2", () => {
    const r = calcTaxBreakdown(1000, 1);
    expect(r.taxAmount.toNumber()).toBe(500);
    expect(r.amountExcludingTax.toNumber()).toBe(500);
  });

  it("toDecimalPlaces(2) 舍入: 0.005 → 0.00, 0.006 → 0.01", () => {
    // 1 * 0.005 / 1.005 = 0.004975... → 0.00
    // 1 * 0.006 / 1.006 = 0.005964... → 0.01
    const r1 = calcTaxBreakdown(1, 0.005);
    const r2 = calcTaxBreakdown(1, 0.006);
    expect(r1.taxAmount.toNumber()).toBe(0);
    expect(r2.taxAmount.toNumber()).toBe(0.01);
  });
});

describe("isOverAmount", () => {
  it("sum + add = cap → false (严格 greaterThan, 等于不超)", () => {
    expect(isOverAmount(500, 500, 1000)).toBe(false);
  });

  it("sum + add = cap + 0.005 → false (在 0.01 容差内)", () => {
    expect(isOverAmount(500, 500.005, 1000)).toBe(false);
  });

  it("sum + add = cap + 0.02 → false (等于容差, 不超)", () => {
    // 1000 + 0.01 = 1000.01; 1000.01 > 1000.01 → false
    expect(isOverAmount(999.99, 0.02, 1000)).toBe(false);
  });

  it("sum + add = cap + 0.03 → true (超出容差, 严格大于)", () => {
    // 1000 + 0.01 = 1000.01; 1000.02 > 1000.01 → true
    expect(isOverAmount(999.99, 0.03, 1000)).toBe(true);
  });

  it("默认容差 = MONEY_TOLERANCE (0.01)", () => {
    // 999.99 + 0.01 = 1000.00 → 不超
    expect(isOverAmount(999.99, 0.01, 1000)).toBe(false);
    // 999.99 + 0.05 = 1000.04 > 1000.01 → 超
    expect(isOverAmount(999.99, 0.05, 1000)).toBe(true);
  });
});

describe("MONEY_TOLERANCE", () => {
  it("是 Prisma.Decimal('0.01') 实例, 值 = 0.01", () => {
    expect(MONEY_TOLERANCE).toBeInstanceOf(Prisma.Decimal);
    expect(MONEY_TOLERANCE.toNumber()).toBe(0.01);
    expect(MONEY_TOLERANCE.toString()).toBe("0.01");
  });
});
