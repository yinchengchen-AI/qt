// Display formatters shared across pages.
// Pure functions, no React. Keep this file importable from server components.

type NumericInput = number | string | null | undefined;

function toNum(n: NumericInput): number {
  if (n === null || n === undefined || n === "") return 0;
  if (typeof n === "number") return n;
  const parsed = Number(n);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** "¥1,234,567.89" — used in tables and descriptions. */
export function formatCurrency(n: NumericInput): string {
  const v = toNum(n);
  return (
    "¥" +
    new Intl.NumberFormat("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(v)
  );
}

/** "245.00 万" / "1.20 亿" — used in dashboard KPIs. */
export function formatCompact(n: NumericInput): string {
  const v = toNum(n);
  if (v >= 100_000_000) return (v / 100_000_000).toFixed(2) + " 亿";
  if (v >= 10_000) return (v / 10_000).toFixed(2) + " 万";
  return v.toString();
}

/** "2026-06-09" — date only, no time. */
export function formatDate(s: string | Date | null | undefined): string {
  if (!s) return "-";
  const d = typeof s === "string" ? new Date(s) : s;
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

/** "2026-06-09 17:30" — date + time, locale-formatted. */
export function formatDateTime(s: string | Date | null | undefined): string {
  if (!s) return "-";
  const d = typeof s === "string" ? new Date(s) : s;
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/** "34.29%" — accepts a fraction (0.3429) by default, or an already-percent number with isPercent=true. */
export function formatPercent(
  n: NumericInput,
  digits = 2,
  opts: { isPercent?: boolean } = {}
): string {
  const v = toNum(n);
  const pct = opts.isPercent ? v : v * 100;
  return pct.toFixed(digits) + "%";
}
