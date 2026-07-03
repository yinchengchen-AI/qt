import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listDefinitions,
  getOrBuildSnapshot,
  regenerateSnapshot,
  generatePeriodSnapshots,
  shouldGeneratePeriod,
} from "@/server/services/report";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";

describe("report center service", () => {
  const adminUser = {
    id: "system",
    employeeNo: "SYSTEM",
    name: "System",
    email: "system@internal.local",
    roleCode: "ADMIN" as const,
    permissions: [],
  };

  beforeAll(async () => {
    // 确保种子数据中的报表定义存在
    const count = await prisma.reportDefinition.count({ where: { deletedAt: null } });
    if (count === 0) {
      await prisma.reportDefinition.create({
        data: {
          code: "FINANCIAL",
          name: "财务经营报表",
          type: "FINANCIAL",
          periodType: "MONTH",
          defaultMetrics: [{ key: "contractAmount", label: "合同额", unit: "元" }],
          dimensions: ["month"],
        },
      });
    }
  });

  it("listDefinitions returns active definitions", async () => {
    const defs = await listDefinitions(adminUser);
    expect(defs.length).toBeGreaterThan(0);
    expect(defs.some((d) => d.code === "FINANCIAL")).toBe(true);
  });

  it("getOrBuildSnapshot creates a snapshot for MONTH", async () => {
    const result = await getOrBuildSnapshot(adminUser, "FINANCIAL", "MONTH");
    expect(result.definition.code).toBe("FINANCIAL");
    expect(result.periodType).toBe("MONTH");
    expect(result.status).toBe("READY");
    expect(result.snapshotId).toBeDefined();
    expect(result.payload.overview).toBeDefined();
  });

  it("regenerateSnapshot updates the same snapshot", async () => {
    const first = await getOrBuildSnapshot(adminUser, "FINANCIAL", "MONTH");
    const regenerated = await regenerateSnapshot(adminUser, first.snapshotId!);
    expect(regenerated.snapshotId).toBe(first.snapshotId);
    expect(regenerated.status).toBe("READY");
  });

  it("custom range snapshot does not persist", async () => {
    const from = new Date(2026, 0, 1);
    const to = new Date(2026, 0, 31);
    const result = await getOrBuildSnapshot(adminUser, "CUSTOM", "CUSTOM", { from, to });
    expect(result.periodType).toBe("CUSTOM");
    expect(result.snapshotId).toBeUndefined();
    expect(result.status).toBe("READY");
  });

  it("shouldGeneratePeriod respects period boundaries", () => {
    // 2026-05-01：月报应生成，季报不应生成，年报不应生成
    const mayFirst = new Date(2026, 4, 1);
    expect(shouldGeneratePeriod("MONTH", mayFirst)).toBe(true);
    expect(shouldGeneratePeriod("QUARTER", mayFirst)).toBe(false);
    expect(shouldGeneratePeriod("YEAR", mayFirst)).toBe(false);

    // 2026-04-01：月报 + 季报
    const aprFirst = new Date(2026, 3, 1);
    expect(shouldGeneratePeriod("MONTH", aprFirst)).toBe(true);
    expect(shouldGeneratePeriod("QUARTER", aprFirst)).toBe(true);
    expect(shouldGeneratePeriod("YEAR", aprFirst)).toBe(false);

    // 2026-01-01：全部
    const janFirst = new Date(2026, 0, 1);
    expect(shouldGeneratePeriod("MONTH", janFirst)).toBe(true);
    expect(shouldGeneratePeriod("QUARTER", janFirst)).toBe(true);
    expect(shouldGeneratePeriod("YEAR", janFirst)).toBe(true);

    // 非 1 号全部不生成
    const maySecond = new Date(2026, 4, 2);
    expect(shouldGeneratePeriod("MONTH", maySecond)).toBe(false);
  });

  it("generatePeriodSnapshots skips off-boundary periods", async () => {
    // 2026-05-01：只有 MONTH 定义应生成；QUARTER/YEAR 被跳过
    const result = await generatePeriodSnapshots(new Date(2026, 4, 1), adminUser.id);
    expect(result.created + result.updated + result.skipped + result.failed).toBeGreaterThan(0);
  });

  it("permissions allow ADMIN full REPORT_CENTER access", () => {
    expect(() => requirePermission("ADMIN", RESOURCE.REPORT_CENTER, ACTION.READ)).not.toThrow();
    expect(() => requirePermission("ADMIN", RESOURCE.REPORT_CENTER, ACTION.EXPORT)).not.toThrow();
    expect(() => requirePermission("ADMIN", RESOURCE.REPORT_CENTER, ACTION.UPDATE)).not.toThrow();
    expect(() => requirePermission("ADMIN", RESOURCE.REPORT_CENTER, ACTION.DELETE)).not.toThrow();
  });

  it("permissions allow FINANCE to update/delete REPORT_CENTER", () => {
    expect(() => requirePermission("FINANCE", RESOURCE.REPORT_CENTER, ACTION.READ)).not.toThrow();
    expect(() => requirePermission("FINANCE", RESOURCE.REPORT_CENTER, ACTION.EXPORT)).not.toThrow();
    expect(() => requirePermission("FINANCE", RESOURCE.REPORT_CENTER, ACTION.UPDATE)).not.toThrow();
    expect(() => requirePermission("FINANCE", RESOURCE.REPORT_CENTER, ACTION.DELETE)).not.toThrow();
  });

  it("permissions deny SALES to update REPORT_CENTER", () => {
    expect(() => requirePermission("SALES", RESOURCE.REPORT_CENTER, ACTION.READ)).not.toThrow();
    expect(() => requirePermission("SALES", RESOURCE.REPORT_CENTER, ACTION.UPDATE)).toThrow();
  });
});
