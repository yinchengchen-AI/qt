import { formatCompact } from "@/lib/format";
import type { DashboardSummary } from "@/lib/types/dashboard";

export function buildTownChartData(
  rows: DashboardSummary["townDistribution"],
  limit = 10
): { data: { town: string; count: number }[]; truncated: boolean } {
  const towns = rows.map((row) => ({ town: row.town || "未录入", count: row.count }));
  const truncated = towns.length > limit;

  return {
    data: truncated
      ? [
          ...towns.slice(0, limit),
          { town: "其他", count: towns.slice(limit).reduce((sum, row) => sum + row.count, 0) }
        ]
      : towns,
    truncated
  };
}

export function buildTodoItems(input: {
  pendingInvoiceCount: number;
  over90Amount: number;
  primaryColor: string;
}): { label: string; value: string; href: string; color: string }[] {
  const items: { label: string; value: string; href: string; color: string }[] = [];

  if (input.pendingInvoiceCount > 0) {
    items.push({
      label: "待开票",
      value: `${input.pendingInvoiceCount} 张`,
      href: "/invoices",
      color: input.primaryColor
    });
  }
  if (input.over90Amount > 0) {
    items.push({
      label: "90+ 账龄",
      value: formatCompact(input.over90Amount),
      href: "/statistics/aging",
      color: "#ff4d4f"
    });
  }

  return items;
}
