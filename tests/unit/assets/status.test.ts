import { describe, it, expect } from "vitest";
import { computeAssetStatus, EXPIRING_SOON_DAYS, daysUntil } from "@/lib/assets/status";

describe("computeAssetStatus", () => {
  const now = new Date("2026-06-15T00:00:00Z");
  function addDays(d: number): string {
    return new Date(now.getTime() + d * 86_400_000).toISOString();
  }

  it("returns VALID when validTo is null", () => {
    expect(computeAssetStatus(null, null, now)).toBe("VALID");
    expect(computeAssetStatus(null, undefined, now)).toBe("VALID");
  });

  it("returns VALID when validTo is 61 days away (just over threshold)", () => {
    expect(computeAssetStatus(null, addDays(EXPIRING_SOON_DAYS + 1), now)).toBe("VALID");
  });

  it("returns EXPIRING_SOON at the threshold (60 days)", () => {
    expect(computeAssetStatus(null, addDays(EXPIRING_SOON_DAYS), now)).toBe("EXPIRING_SOON");
  });

  it("returns EXPIRING_SOON at 1 day", () => {
    expect(computeAssetStatus(null, addDays(1), now)).toBe("EXPIRING_SOON");
  });

  it("returns EXPIRING_SOON at 0 days (today)", () => {
    expect(computeAssetStatus(null, addDays(0), now)).toBe("EXPIRING_SOON");
  });

  it("returns EXPIRED 1 day ago", () => {
    expect(computeAssetStatus(null, addDays(-1), now)).toBe("EXPIRED");
  });

  it("returns EXPIRED 100 days ago", () => {
    expect(computeAssetStatus(null, addDays(-100), now)).toBe("EXPIRED");
  });

  it("returns VALID for invalid date string", () => {
    expect(computeAssetStatus(null, "not-a-date", now)).toBe("VALID");
  });

  it("accepts both string and Date for validTo", () => {
    const d = new Date(addDays(-1));
    expect(computeAssetStatus(null, d, now)).toBe("EXPIRED");
  });
});

describe("daysUntil", () => {
  const now = new Date("2026-06-15T00:00:00Z");
  it("returns null for null", () => {
    expect(daysUntil(null, now)).toBe(null);
    expect(daysUntil(undefined, now)).toBe(null);
  });
  it("returns positive int for future", () => {
    const d = new Date(now.getTime() + 5 * 86_400_000 + 1000);
    const r = daysUntil(d, now);
    expect(r).toBeGreaterThanOrEqual(5);
  });
  it("returns null for invalid", () => {
    expect(daysUntil("not-a-date", now)).toBe(null);
  });
});
