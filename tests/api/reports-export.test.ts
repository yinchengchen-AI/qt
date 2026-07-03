// 报表中心导出测试
//
// 覆盖:
//   1) PERFORMANCE 报表导出: 2 个 sheets (员工业绩汇总 + 签约明细)
//   2) 员工业绩汇总按签约人 (signerSummary) 聚合, 与签约明细同口径
//   3) 员工业绩汇总不包含 userId / employeeNo / signerEmployeeNo
//   4) 签约明细字段对齐 PDF 5 字段 + 合同号 + 签订日期, 不含服务项目代码
//   5) 签约人小计行: rowType 不带工号, subtotalWan 写万元
//   6) 全公司合计行: subtotalWan 写万元
//   7) FINANCIAL / BUSINESS 报表导出: 各 1 个 section
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

async function loadMay(code: "PERFORMANCE" | "FINANCIAL" | "BUSINESS"): Promise<string | null> {
  const snap = await prisma.reportSnapshot.findFirst({
    where: { deletedAt: null, periodLabel: "2026年5月", definition: { code } },
    select: { id: true },
  });
  return snap?.id ?? null;
}

describe("报表中心导出 prepareExportSections", () => {
  it("PERFORMANCE 报表: 输出 2 个 sheets (员工业绩汇总 + 签约明细)", async () => {
    const id = await loadMay("PERFORMANCE");
    if (!id) {
      console.warn("[skip] no PERFORMANCE 2026年5月 snapshot");
      return;
    }
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const names = res.sections.map((s) => s.name);
    expect(names).toContain("员工业绩汇总");
    expect(names).toContain("签约明细");
  });

  it("PERFORMANCE 员工业绩汇总: 按签约人聚合, 与签约明细同口径", async () => {
    const id = await loadMay("PERFORMANCE");
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const summary = res.sections.find((s: ExportSheet) => s.name === "员工业绩汇总")!;
    const detail = res.sections.find((s: ExportSheet) => s.name === "签约明细")!;
    // 汇总行数应该 == 签约明细里的签约人分组数 (而不是老板/owner)
    // 1 个全公司合计行 1 个小计, 这些不算合同;
    // 这里数签约人姓名: summary 出现的人名集合, 应该 = detail 里出现的人名集合
    const summaryNames = new Set(summary.rows.map((r) => String(r.name)).filter(Boolean));
    // 签约明细里的合同行/小计行 都有 signerName, 收集去重
    const detailSigners = new Set(
      detail.rows
        .filter((r) => r.signerName)
        .map((r) => String(r.signerName))
    );
    expect(summaryNames.size).toBeGreaterThan(0);
    // 关键: 汇总里所有的人, 都应该出现在签约明细里 (反之不一定, 因为汇总可能包含
    // 别的有 invoice 但没合同的 signer)
    for (const n of summaryNames) {
      expect(detailSigners.has(n)).toBe(true);
    }
  });

  it("PERFORMANCE 员工业绩汇总: 不暴露 userId / employeeNo", async () => {
    const id = await loadMay("PERFORMANCE");
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const summary = res.sections.find((s: ExportSheet) => s.name === "员工业绩汇总")!;
    const keys = summary.columns.map((c) => c.key);
    expect(keys).not.toContain("userId");
    expect(keys).not.toContain("employeeNo");
    expect(keys).toContain("name");
    expect(keys).toContain("contractCount");
    expect(keys).toContain("contractAmount");
    expect(keys).toContain("invoiceAmount");
    expect(keys).toContain("paymentAmount");
  });

  it("PERFORMANCE 签约明细: 不暴露服务项目代码 / 签约人工号", async () => {
    const id = await loadMay("PERFORMANCE");
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const detail = res.sections.find((s: ExportSheet) => s.name === "签约明细")!;
    const keys = detail.columns.map((c) => c.key);
    expect(keys).not.toContain("serviceType");      // 内部 enum code, 不外露
    expect(keys).not.toContain("signerEmployeeNo");
    // 5 PDF 字段必须出现
    for (const k of ["region", "customerName", "serviceTypeLabel", "signerName", "totalAmount"]) {
      expect(keys).toContain(k);
    }
    // 辅助字段: 合同号 + 签订日期 (方便对回实际合同)
    expect(keys).toContain("contractNo");
    expect(keys).toContain("signDate");
    // 小计列 (万元)
    expect(keys).toContain("subtotalWan");
  });

  it("PERFORMANCE 签约明细: 签约人小计 + 全公司合计 含 subtotalWan (万元)", async () => {
    const id = await loadMay("PERFORMANCE");
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const detail = res.sections.find((s: ExportSheet) => s.name === "签约明细")!;
    const subtotalRows = detail.rows.filter((r) => String(r.rowType).endsWith("小计")) as Array<{ subtotalWan: number }>;
    const totalRow = detail.rows.find((r) => String(r.rowType).includes("合计")) as { subtotalWan: number } | undefined;
    expect(subtotalRows.length).toBeGreaterThan(0);
    for (const r of subtotalRows) {
      expect(r.subtotalWan).toBeGreaterThan(0);
    }
    expect(totalRow).toBeDefined();
    expect(totalRow!.subtotalWan).toBeGreaterThan(0);
  });

  it("PERFORMANCE 签约明细: 签约人小计行 rowType 不带工号", async () => {
    const id = await loadMay("PERFORMANCE");
    if (!id) return;
    const res = await prepareExportSections(SYSTEM_ACTOR, id);
    const detail = res.sections.find((s: ExportSheet) => s.name === "签约明细")!;
    const subtotalRows = detail.rows.filter((r) => String(r.rowType).endsWith("小计")) as Array<{ rowType: string }>;
    for (const r of subtotalRows) {
      expect(r.rowType).not.toMatch(/[（(].+[）)]/);
    }
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
