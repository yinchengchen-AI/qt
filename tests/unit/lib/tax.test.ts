// 前端预览计算(lib/tax.ts)单元测试
// 覆盖: calcTaxBreakdownPreview 基本用例 + 非法输入兜底
//       与 lib/money.ts calcTaxBreakdown(Prisma.Decimal 服务端权威实现) 的 parity, 防两实现漂移
//       OVER_LIMIT_TOLERANCE 与 MONEY_TOLERANCE 对齐哨兵
import { describe, it, expect } from "vitest";
import { calcTaxBreakdownPreview, OVER_LIMIT_TOLERANCE } from "@/lib/tax";
import { calcTaxBreakdown } from "@/lib/money";
import { MONEY_TOLERANCE } from "@/lib/money-tolerance";
import { TAX_RATE_OPTIONS } from "@/lib/validators/_shared";

describe("calcTaxBreakdownPreview", () => {
  it("整数 1000 / 0.06 → taxAmount 56.60, excluding 943.40", () => {
    const r = calcTaxBreakdownPreview(1000, 0.06);
    expect(r.taxAmount).toBe(56.6);
    expect(r.amountExcludingTax).toBe(943.4);
  });

  it("0% 税率 → taxAmount = 0, excluding = total", () => {
    const r = calcTaxBreakdownPreview(1000, 0);
    expect(r.taxAmount).toBe(0);
    expect(r.amountExcludingTax).toBe(1000);
  });

  it("零头金额 100.03 / 0.13 与大额 999999.99 / 0.09", () => {
    const r1 = calcTaxBreakdownPreview(100.03, 0.13);
    expect(r1.taxAmount).toBeCloseTo(11.51, 2);
    expect(r1.amountExcludingTax).toBeCloseTo(88.52, 2);
    const r2 = calcTaxBreakdownPreview(999999.99, 0.09);
    expect(r2.taxAmount + r2.amountExcludingTax).toBeCloseTo(999999.99, 2);
  });

  it("非法输入(NaN / 非正金额 / 负税率)兜底返回 0", () => {
    expect(calcTaxBreakdownPreview(NaN, 0.06)).toEqual({ taxAmount: 0, amountExcludingTax: 0 });
    expect(calcTaxBreakdownPreview(0, 0.06)).toEqual({ taxAmount: 0, amountExcludingTax: 0 });
    expect(calcTaxBreakdownPreview(-100, 0.06)).toEqual({ taxAmount: 0, amountExcludingTax: 0 });
    expect(calcTaxBreakdownPreview(100, -0.06)).toEqual({ taxAmount: 0, amountExcludingTax: 0 });
    expect(calcTaxBreakdownPreview(100, NaN)).toEqual({ taxAmount: 0, amountExcludingTax: 0 });
  });
});

describe("calcTaxBreakdownPreview 与 calcTaxBreakdown parity", () => {
  const amounts = [0.01, 1, 100, 100.03, 1000, 12345.67, 999999.99];

  it("(金额 × 标准税率)矩阵下税额/不含税金额完全一致", () => {
    for (const amount of amounts) {
      for (const rate of TAX_RATE_OPTIONS) {
        const preview = calcTaxBreakdownPreview(amount, rate);
        const authoritative = calcTaxBreakdown(amount, rate);
        expect(preview.taxAmount).toBe(authoritative.taxAmount.toNumber());
        expect(preview.amountExcludingTax).toBe(authoritative.amountExcludingTax.toNumber());
      }
    }
  });
});

describe("OVER_LIMIT_TOLERANCE", () => {
  it("与 MONEY_TOLERANCE (0.01) 对齐", () => {
    expect(OVER_LIMIT_TOLERANCE).toBe(MONEY_TOLERANCE.toNumber());
  });
});
