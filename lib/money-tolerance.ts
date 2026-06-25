// 0.01 元容差, 合同/发票/回款三处共用。
// 替换 contract-billing.ts:TOLERANCE = 0.01 + invoice.ts / payment.ts 的
// 多处 new Prisma.Decimal("0.01") 字面量。
//
// 用 Prisma.Decimal 而不是 number, 是为了在 lib 层与 service 层 R-08/R-11/R-12
// 累计比较语义对齐 (都走 Decimal.greaterThan 等方法), 避免混 number 和
// Decimal 时的隐式转换导致的 0.0000001 漂移.
import { Prisma } from "@prisma/client";

export const MONEY_TOLERANCE = new Prisma.Decimal("0.01");
