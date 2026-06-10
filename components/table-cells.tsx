import { formatCurrency, formatDate, formatDateTime, formatPercent } from "@/lib/format";

type Value = string | number | null | undefined;

export function CurrencyCell({ value }: { value: Value }) {
  if (value === null || value === undefined || value === "") return <span>-</span>;
  return <span style={{ fontFeatureSettings: '"tnum"' }}>{formatCurrency(value)}</span>;
}

export function PercentCell({
  value,
  digits = 2,
  isPercent = false
}: {
  value: Value;
  digits?: number;
  isPercent?: boolean;
}) {
  if (value === null || value === undefined || value === "") return <span>-</span>;
  return <span>{formatPercent(value, digits, { isPercent })}</span>;
}

export function DateCell({ value }: { value: Value | Date }) {
  return <span>{formatDate(value as string | Date | null | undefined)}</span>;
}

export function DateTimeCell({ value }: { value: Value | Date }) {
  return <span>{formatDateTime(value as string | Date | null | undefined)}</span>;
}
