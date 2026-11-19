import { describe, expect, it } from "vitest";
import type { DashboardSummary } from "@/lib/types/dashboard";
import { buildTodoItems, buildTownChartData } from "@/components/dashboard/dashboard-view-model";

describe("buildTownChartData", () => {
  it("keeps the top 10 towns and aggregates the remaining rows into 其他 without mutating input", () => {
    const rows: DashboardSummary["townDistribution"] = Array.from({ length: 12 }, (_, index) => ({
      town: `镇街 ${index + 1}`,
      count: index + 1
    }));
    const originalRows = structuredClone(rows);

    const result = buildTownChartData(rows);

    expect(result.truncated).toBe(true);
    expect(result.data).toEqual([
      ...Array.from({ length: 10 }, (_, index) => ({ town: `镇街 ${index + 1}`, count: index + 1 })),
      { town: "其他", count: 23 }
    ]);
    expect(rows).toEqual(originalRows);
  });

  it("returns empty data without adding 其他", () => {
    expect(buildTownChartData([])).toEqual({ data: [], truncated: false });
  });
});

describe("buildTodoItems", () => {
  it("returns no todos when pending invoices and 90+ aging are both zero", () => {
    expect(buildTodoItems({ pendingInvoiceCount: 0, over90Amount: 0, primaryColor: "#1677ff" })).toEqual([]);
  });

  it("formats pending invoice count and 90+ aging amount with their links and colors", () => {
    expect(buildTodoItems({ pendingInvoiceCount: 3, over90Amount: 12345, primaryColor: "#1677ff" })).toEqual([
      { label: "待开票", value: "3 张", href: "/invoices", color: "#1677ff" },
      { label: "90+ 账龄", value: "1.23 万", href: "/statistics/aging", color: "#ff4d4f" }
    ]);
  });

  it("does not produce dunning or legal todo items", () => {
    const items = buildTodoItems({ pendingInvoiceCount: 3, over90Amount: 12345, primaryColor: "#1677ff" });

    expect(JSON.stringify(items)).not.toContain("催收中");
    expect(JSON.stringify(items)).not.toContain("法务介入");
  });
});
