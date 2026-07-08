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

/**
 * 内部: Date → "YYYY-MM-DD" (本地时区).
 * 跨页面统一显示格式, 导出与打印共用, 不依赖运行时 locale.
 */
function formatYmd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "HH:mm" (本地时区). */
function formatHm(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "2026-06-09" — date only, no time. */
export function formatDate(s: string | Date | null | undefined): string {
  if (!s) return "-";
  const d = typeof s === "string" ? new Date(s) : s;
  if (Number.isNaN(d.getTime())) return "-";
  return formatYmd(d);
}

/** "2026-06-09 17:30" — date + time, locale-formatted. */
export function formatDateTime(s: string | Date | null | undefined): string {
  if (!s) return "-";
  const d = typeof s === "string" ? new Date(s) : s;
  if (Number.isNaN(d.getTime())) return "-";
  return `${formatYmd(d)} ${formatHm(d)}`;
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

/** 身份证号脱敏：110101********1237 */
export function maskIdCard(v: string | null | undefined): string {
  if (!v) return "—";
  if (v.length <= 8) return v;
  return v.slice(0, 4) + "********" + v.slice(-4);
}

/** 银行卡号脱敏：6222 **** **** 0123 */
export function maskBankAccount(v: string | null | undefined): string {
  if (!v) return "—";
  if (v.length <= 8) return v;
  return v.slice(0, 4) + " **** **** " + v.slice(-4);
}

/** 手机号脱敏：138****0000 */
export function maskPhone(v: string | null | undefined): string {
  if (!v) return "—";
  if (v.length <= 7) return v;
  return v.slice(0, 3) + "****" + v.slice(-4);
}

const GENDER_LABEL: Record<string, string> = {
  MALE: "男",
  FEMALE: "女",
  OTHER: "其他"
};

export function formatGender(v: string | null | undefined): string {
  return v ? (GENDER_LABEL[v] ?? v) : "—";
}

const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  FULL_TIME: "全职",
  PART_TIME: "兼职",
  INTERN: "实习",
  CONTRACTOR: "外包"
};

export function formatEmploymentType(v: string | null | undefined): string {
  return v ? (EMPLOYMENT_TYPE_LABEL[v] ?? v) : "—";
}

/**
 * Normalize a value from a form field (string | Date | dayjs | moment | undefined)
 * to a strict ISO-8601 datetime string (Z suffix) that satisfies `z.iso.datetime()`.
 *
 * Returns undefined for null/empty/invalid inputs so callers can pass the result
 * directly into a Zod optional() / .default() chain.
 */
export function toIsoDateTime(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (typeof value === "string") {
    // "YYYY-MM-DD" or already-ISO with offset/Z; new Date() handles all of them
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  // dayjs / moment: prefer toDate() when available
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate === "function") {
    const d = (toDate as () => unknown).call(value);
    if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
  }
  return undefined;
}
