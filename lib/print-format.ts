// 打印文档(PDF 打印页)专用字段格式化。
// 与页面端区分: 空值统一 "—"(打印稿更正式), 金额带 ¥ 与千分位。
// 全部基于 lib/format.ts 包装, 不重复实现格式化逻辑。
// 使用方: app/api/...[id]/pdf/route.ts 各打印路由。

import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPercent,
} from "@/lib/format";

/** 打印文档空值占位符 */
export const PRINT_EMPTY = "—";

/** 数值入参: 兼容 Prisma Decimal 等带 toString 的数值对象 */
type NumericLike = number | string | { toString(): string } | null | undefined;

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

function toNumInput(v: NumericLike): number | string {
  if (typeof v === "number" || typeof v === "string") return v;
  return (v as { toString(): string }).toString();
}

/** 文本兜底: 空 → "—" */
export function pfText(v: string | number | null | undefined): string {
  return isEmpty(v) ? PRINT_EMPTY : String(v);
}

/** 金额: "¥1,234.00", 空 → "—" */
export function pfAmount(v: NumericLike): string {
  return isEmpty(v) ? PRINT_EMPTY : formatCurrency(toNumInput(v));
}

/** 日期: "2026-06-09", 空或无效日期 → "—" */
export function pfDate(v: string | Date | null | undefined): string {
  if (isEmpty(v)) return PRINT_EMPTY;
  const s = formatDate(v);
  return s === "-" ? PRINT_EMPTY : s;
}

/** 日期时间: "2026-06-09 17:30", 空或无效日期 → "—" */
export function pfDateTime(v: string | Date | null | undefined): string {
  if (isEmpty(v)) return PRINT_EMPTY;
  const s = formatDateTime(v);
  return s === "-" ? PRINT_EMPTY : s;
}

/** 百分比: 0.06 → "6.00%" (输入为 fraction), 空 → "—" */
export function pfPercent(ratio: NumericLike, digits = 2): string {
  return isEmpty(ratio) ? PRINT_EMPTY : formatPercent(toNumInput(ratio), digits);
}

/** 人员: "张三(EMP001)", 空 → "—" */
export function pfPerson(
  u: { name: string; employeeNo: string } | null | undefined,
): string {
  return u ? `${u.name}(${u.employeeNo})` : PRINT_EMPTY;
}
