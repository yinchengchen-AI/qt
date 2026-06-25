// 金额计算统一工具。所有 taxAmount / amountExcludingTax / 累计比较走 Prisma.Decimal,
// 避免 JS number 浮点漂移导致合同侧与发票侧判定不一致。
import { Prisma } from "@prisma/client";
import { MONEY_TOLERANCE } from "@/lib/money-tolerance";

export type MoneyBreakdown = {
  totalAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  amountExcludingTax: Prisma.Decimal;
};

/** 含税总额 → 税额 + 不含税金额 */
export function calcTaxBreakdown(
  totalAmount: Prisma.Decimal | number | string,
  taxRate: Prisma.Decimal | number | string,
): MoneyBreakdown {
  const total = new Prisma.Decimal(totalAmount);
  const rate = new Prisma.Decimal(taxRate);
  const divisor = new Prisma.Decimal(1).plus(rate);
  const taxAmount = total.mul(rate).div(divisor).toDecimalPlaces(2);
  const amountExcludingTax = total.minus(taxAmount).toDecimalPlaces(2);
  return { totalAmount: total, taxAmount, amountExcludingTax };
}

/** 累加后是否超出上限(带容差)。用于 R-08/R-11/R-12 累计判定 */
export function isOverAmount(
  sum: Prisma.Decimal | number | string,
  add: Prisma.Decimal | number | string,
  cap: Prisma.Decimal | number | string,
  tolerance: Prisma.Decimal = MONEY_TOLERANCE,
): boolean {
  return new Prisma.Decimal(sum).plus(add).greaterThan(new Prisma.Decimal(cap).plus(tolerance));
}
