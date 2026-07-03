import { describe, it, expect } from "vitest";
import { resolvePeriod, previousPeriod, customPeriodLabel } from "@/server/services/report";

describe("report period helpers", () => {
  it("resolve MONTH for 2026-06-15", () => {
    const ref = new Date(2026, 5, 15);
    const r = resolvePeriod("MONTH", ref);
    expect(r.periodLabel).toBe("2026年6月");
    expect(r.from).toEqual(new Date(2026, 5, 1, 0, 0, 0, 0));
    expect(r.to).toEqual(new Date(2026, 5, 30, 23, 59, 59, 999));
  });

  it("resolve QUARTER for 2026-05-15", () => {
    const ref = new Date(2026, 4, 15);
    const r = resolvePeriod("QUARTER", ref);
    expect(r.periodLabel).toBe("2026年Q2");
    expect(r.from).toEqual(new Date(2026, 3, 1, 0, 0, 0, 0));
    expect(r.to).toEqual(new Date(2026, 5, 30, 23, 59, 59, 999));
  });

  it("resolve YEAR for 2026-08-01", () => {
    const ref = new Date(2026, 7, 1);
    const r = resolvePeriod("YEAR", ref);
    expect(r.periodLabel).toBe("2026年");
    expect(r.from).toEqual(new Date(2026, 0, 1, 0, 0, 0, 0));
    expect(r.to).toEqual(new Date(2026, 11, 31, 23, 59, 59, 999));
  });

  it("previous MONTH from 2026-06-01", () => {
    const r = previousPeriod("MONTH", new Date(2026, 5, 1));
    expect(r.periodLabel).toBe("2026年5月");
  });

  it("previous QUARTER from 2026-04-01", () => {
    const r = previousPeriod("QUARTER", new Date(2026, 3, 1));
    expect(r.periodLabel).toBe("2026年Q1");
  });

  it("previous YEAR from 2026-01-01", () => {
    const r = previousPeriod("YEAR", new Date(2026, 0, 1));
    expect(r.periodLabel).toBe("2025年");
  });

  it("customPeriodLabel formats range", () => {
    const from = new Date(2026, 0, 5);
    const to = new Date(2026, 3, 20);
    expect(customPeriodLabel(from, to)).toBe("2026-01-05 ~ 2026-04-20");
  });
});
