// 报表中心导出测试
//
// 覆盖:
//   1) PERFORMANCE 报表导出: 2 个 sheets (员工业绩汇总 + 签约明细)
//   2) 员工业绩汇总不包含 userId / employeeNo (工号是内部主键, 不该外露)
//   3) 签约明细不包含 signerEmployeeNo
//   4) 签约明细字段对齐 PDF 5 字段 (region / customerName / serviceTypeLabel / signerName / totalAmount)
//   5) 签约明细末行是全公司合计
//   6) FINANCIAL / BUSINESS 报表导出: 各 1 个 section
//
// DB 不可达时整组 skip.

import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { prepareExportSections } from "@/server/services/report";
import type { SessionUser } from "@/lib/session";

const SYSTEM_ACTOR: SessionUser = {
  id: "system",
  employeeNo: "SYSTEM",
  name: "System",
  email: "system@internal.local",
  roleCode: "ADMIN",
  permissions: [],
};

type ExportSheet = {
  name: string;
  rows: Record<string, unknown>[];
  columns: Array<{ header: string; key: string }>;
};

async function loadPerformanceMay(): Promise<string | null> {
  const snap = await prisma.reportSnapshot.findFirst({
    where: { deletedAt: null, periodLabel: "2026年5月", definition: { code: "PERFORMANCE" } },
    select: { id: true },
  });
  return snap?.id ?? null;
}

describe("报表中心导出 prepareExportSections", () => {
  it("PERFORMANCE 报表: 输出 2 个 sheets (员工业绩汇总 + 签约明细)", async () => {
    const id = await loadPerformanceMay();
    if (!id) {
      console.warn("[skip] no PERFORMANCE 2026年5月 snapshot");
      return;
    }
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const names = res.sections.map((s) => s.name);
    expect(names).toContain("员工业绩汇总");
    expect(names).toContain("签约明细");
  });

  it("PERFORMANCE 员工业绩汇总: 不暴露 userId / employeeNo 字段", async () => {
    const id = await loadPerformanceMay();
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const summary = res.sections.find((s: ExportSheet) => s.name === "员工业绩汇总");
    expect(summary).toBeDefined();
    const keys = summary!.columns.map((c) => c.key);
    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("employeeNo");
    // 必须保留业务字段
    expect(keys).toContain("name");
    expect(keys).toContain("contractAmount");
    expect(keys).toContain("invoiceAmount");
    expect(keys).toContain("paymentAmount");
    expect(keys).toContain("contractCount");
  });

  it("PERFORMANCE 签约明细: 不暴露 signerEmployeeNo 字段", async () => {
    const id = await loadPerformanceMay();
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const detail = res.sections.find((s: ExportSheet) => s.name === "签约明细");
    expect(detail).toBeDefined();
    const keys = detail!.columns.map((c) => c.key);
    expect(keys).not.toContain("signerEmployeeNo");
  });

  it("PERFORMANCE 签约明细: 字段对齐 PDF 5 字段", async () => {
    const id = await loadPerformanceMay();
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const detail = res.sections.find((s: ExportSheet) => s.name === "签约明细")!;
    const keys = detail.columns.map((c) => c.key);
    for (const k of ["region", "customerName", "serviceTypeLabel", "signerName", "totalAmount"]) {
      expect(keys).toContain(k);
    }
    expect(keys).toContain("subtotalWan");
  });

  it("PERFORMANCE 签约明细: 末行是全公司合计", async () => {
    const id = await loadPerformanceMay();
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const detail = res.sections.find((s: ExportSheet) => s.name === "签约明细")!;
    const lastRow = detail.rows[detail.rows.length - 1] as { rowType: string; subtotalWan: number };
    expect(String(lastRow.rowType)).toContain("合计");
    expect(Number(lastRow.subtotalWan)).toBeGreaterThanOrEqual(0);
  });

  it("PERFORMANCE 签约明细: 签约人小计行 rowType 不带工号", async () => {
    const id = await loadPerformanceMay();
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const detail = res.sections.find((s: ExportSheet) => s.name === "签约明细")!;
    const subtotalRows = detail.rows.filter((r) => String(r.rowType).endsWith("小计")) as Array<{ rowType: string }>;
    expect(subtotalRows.length).toBeGreaterThan(0);
    for (const r of subtotalRows) {
      // "陈涛 小计" 不应带 "(chentao)" 这种
      expect(r.rowType).not.toMatch(/[（(].+[）)]/);
    }
  });

  it("FINANCIAL 报表: 1 个 section (财务趋势明细)", async () => {
    const snap = await prisma.reportSnapshot.findFirst({
      where: { deletedAt: null, periodLabel: "2026年5月", definition: { code: "FINANCIAL" } },
      select: { id: true },
    });
    if (!snap) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, snap.id);
    expect(res.sections.length).toBe(1);
    expect(res.sections[0]!.name).toBe("财务趋势明细");
  });

  it("BUSINESS 报表: 1 个 section (区域统计明细)", async () => {
    const snap = await prisma.reportSnapshot.findFirst({
      where: { deletedAt: null, periodLabel: "2026年5月", definition: { code: "BUSINESS" } },
      select: { id: true },
    });
    if (!snap) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, snap.id);
    expect(res.sections.length).toBe(1);
    expect(res.sections[0]!.name).toBe("区域统计明细");
  });
});
