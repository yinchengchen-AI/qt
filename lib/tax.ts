// 金额+税率 前端预览用纯计算。零依赖, 不 import @prisma/client, 可安全进客户端 bundle。
// 公式与 lib/money.ts calcTaxBreakdown 严格一致(tax = total × rate/(1+rate), ROUND_HALF_UP 到 2 位),
// parity 由 tests/unit/lib/tax.test.ts 保证, 改公式时两处必须同步。
// 服务端权威计算仍以 lib/money.ts(Prisma.Decimal) 为准, 本文件只做展示层近似。

// 与 lib/money-tolerance.ts MONEY_TOLERANCE (0.01 元) 对齐; 客户端不可引用后者(依赖 @prisma/client)
export const OVER_LIMIT_TOLERANCE = 0.01;

export type TaxBreakdownPreview = {
  taxAmount: number;
  amountExcludingTax: number;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 含税总额 → 税额 + 不含税金额(前端预览近似值) */
export function calcTaxBreakdownPreview(totalAmount: number, taxRate: number): TaxBreakdownPreview {
  if (!Number.isFinite(totalAmount) || !Number.isFinite(taxRate) || totalAmount <= 0 || taxRate < 0) {
    return { taxAmount: 0, amountExcludingTax: 0 };
  }
  const taxAmount = round2((totalAmount * taxRate) / (1 + taxRate));
  return { taxAmount, amountExcludingTax: round2(totalAmount - taxAmount) };
}
