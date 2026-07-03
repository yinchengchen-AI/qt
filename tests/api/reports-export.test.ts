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

async function loadMay(code: "PERFORMANCE" | "FINANCIAL" | "BUSINESS"): Promise<string | null> {
  const snap = await prisma.reportSnapshot.findFirst({
    where: { deletedAt: null, periodLabel: "2026年5月", definition: { code } },
    select: { id: true },
  });
  return snap?.id ?? null;
}

describe("报表中心导出 prepareExportSections (按 PDF 5 字段 + 小计万元格式)", () => {
  it("PERFORMANCE 报表: 只输出 1 个 sheet", async () => {
    const id = await loadMay("PERFORMANCE");
    if (!id) {
      console.warn("[skip] no PERFORMANCE 2026年5月 snapshot");
      return;
    }
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    expect(res.sections.length).toBe(1);
    expect(res.sections[0]!.name).toBe("员工业绩明细（按签约人）");
  });

  it("PERFORMANCE 员工业绩明细: 6 列对齐 PDF 5 字段 + 小计（万元）", async () => {
    const id = await loadMay("PERFORMANCE");
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const detail = res.sections[0]!;
    const keys = detail.columns.map((c) => c.key);
    for (const k of ["region", "customerName", "serviceTypeLabel", "signerName", "totalAmount"]) {
      expect(keys).toContain(k);
    }
    expect(keys).toContain("subtotalWan");
    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("employeeNo");
    expect(keys).not.toContain("serviceType");
    expect(keys).not.toContain("signerEmployeeNo");
    expect(keys).not.toContain("signDate");
    expect(keys).not.toContain("contractNo");
    expect(keys).not.toContain("rowType");
  });

  it("PERFORMANCE 员工业绩明细: 末行 全公司合计 含小计(万元)", async () => {
    const id = await loadMay("PERFORMANCE");
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const detail = res.sections[0]!;
    const last = detail.rows[detail.rows.length - 1] as { signerName: string; subtotalWan: number; totalAmount: number };
    expect(last.signerName).toBe("全公司合计");
    expect(typeof last.subtotalWan).toBe("number");
    expect(last.subtotalWan).toBeGreaterThan(0);
  });

  it("PERFORMANCE 员工业绩明细: 签约人小计行 signerName = {姓名} 小计 (无工号)", async () => {
    const id = await loadMay("PERFORMANCE");
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const detail = res.sections[0]!;
    const subRows = detail.rows.filter(
      (r) => typeof r.signerName === "string" && r.signerName.endsWith("小计") && r.signerName !== "全公司合计"
    ) as Array<{ signerName: string; subtotalWan: number }>;
    expect(subRows.length).toBeGreaterThan(0);
    for (const r of subRows) {
      expect(r.signerName).not.toMatch(/[（(].+[）)]/);
      expect(r.subtotalWan).toBeGreaterThan(0);
    }
  });

  it("PERFORMANCE 不再输出员工业绩汇总 sheet", async () => {
    const id = await loadMay("PERFORMANCE");
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const names = res.sections.map((s) => s.name);
    expect(names).not.toContain("员工业绩汇总");
  });

  it("FINANCIAL 报表: 1 个 section (财务趋势明细)", async () => {
    const id = await loadMay("FINANCIAL");
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    expect(res.sections.length).toBe(1);
    expect(res.sections[0]!.name).toBe("财务趋势明细");
  });

  it("BUSINESS 报表: 1 个 section (区域统计明细)", async () => {
    const id = await loadMay("BUSINESS");
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    expect(res.sections.length).toBe(1);
    expect(res.sections[0]!.name).toBe("区域统计明细");
  });
});
