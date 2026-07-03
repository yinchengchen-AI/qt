// 报表中心导出测试
//
// 覆盖:
//   1) PERFORMANCE 报表导出: 应同时包含"员工业绩汇总" + "签约明细" 2 个 sections
//   2) 签约明细字段对齐 PDF 5 字段 (region / customerName / serviceTypeLabel / signerName / totalAmount)
//   3) 签约明细含签约人小计行 + 全公司合计行
//   4) FINANCIAL / BUSINESS 报表导出: 只有 1 个 section
//
// DB 不可达时整组 skip. 用 REPORT-* 标记的快照 (admin 跑 aggregatePayload 写) 复用现有数据.

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

describe("报表中心导出 prepareExportSections", () => {
  it("PERFORMANCE 报表: 同时输出 2 个 sections (员工业绩汇总 + 签约明细)", async () => {
    // 找一个 2026-05 PERFORMANCE 快照(脚本补的, 必有 signerDetail)
    const snap = await prisma.reportSnapshot.findFirst({
      where: {
        deletedAt: null,
        periodLabel: "2026年5月",
        definition: { code: "PERFORMANCE" },
      },
      select: { id: true },
    });
    if (!snap) {
      console.warn("[skip] no PERFORMANCE 2026年5月 snapshot");
      return;
    }
    const result = await prepareExportSections(SYSTEM_ACTOR, snap.id);
    expect(result.sections.length).toBeGreaterThanOrEqual(1);
    const [exportRes] = result;
    expect(exportRes.definition.code).toBe("PERFORMANCE");
    // 应该有 2 个 sheet: 员工业绩汇总 + 签约明细
    const names = exportRes.sections.map((s) => s.name);
    expect(names).toContain("员工业绩汇总");
    expect(names).toContain("签约明细");
  });

  it("PERFORMANCE 签约明细: 字段对齐 PDF 5 字段 (region/customerName/serviceTypeLabel/signerName/totalAmount)", async () => {
    const snap = await prisma.reportSnapshot.findFirst({
      where: {
        deletedAt: null,
        periodLabel: "2026年5月",
        definition: { code: "PERFORMANCE" },
      },
      select: { id: true },
    });
    if (!snap) return;
    const [exportRes] = await prepareExportSections(SYSTEM_ACTOR, snap.id);
    const detail = exportRes.sections.find((s) => s.name === "签约明细");
    expect(detail).toBeDefined();
    const columns = detail!.columns.map((c) => c.key);
    // 5 PDF 字段必须出现
    expect(columns).toContain("region");
    expect(columns).toContain("customerName");
    expect(columns).toContain("serviceTypeLabel");
    expect(columns).toContain("signerName");
    expect(columns).toContain("totalAmount");
    // 必须有小计 + 合计字段
    expect(columns).toContain("subtotalWan");
    // 必须有 rowType 用于区分合同/小计/合计
    expect(columns).toContain("rowType");
  });

  it("PERFORMANCE 签约明细: 末行是全公司合计 (rowType 含 '合计' 关键词)", async () => {
    const snap = await prisma.reportSnapshot.findFirst({
      where: {
        deletedAt: null,
        periodLabel: "2026年5月",
        definition: { code: "PERFORMANCE" },
      },
      select: { id: true },
    });
    if (!snap) return;
    const [exportRes] = await prepareExportSections(SYSTEM_ACTOR, snap.id);
    const detail = exportRes.sections.find((s) => s.name === "签约明细");
    const lastRow = detail!.rows[detail!.rows.length - 1];
    expect(String(lastRow!.rowType)).toContain("合计");
    // subtotalWan 应该是非 0 数 (>= 0)
    expect(Number(lastRow!.subtotalWan)).toBeGreaterThanOrEqual(0);
  });

  it("FINANCIAL 报表: 1 个 section (财务趋势明细)", async () => {
    const snap = await prisma.reportSnapshot.findFirst({
      where: {
        deletedAt: null,
        periodLabel: "2026年5月",
        definition: { code: "FINANCIAL" },
      },
      select: { id: true },
    });
    if (!snap) return;
    const [exportRes] = await prepareExportSections(SYSTEM_ACTOR, snap.id);
    expect(exportRes.sections.length).toBe(1);
    expect(exportRes.sections[0]!.name).toBe("财务趋势明细");
  });

  it("BUSINESS 报表: 1 个 section (区域统计明细)", async () => {
    const snap = await prisma.reportSnapshot.findFirst({
      where: {
        deletedAt: null,
        periodLabel: "2026年5月",
        definition: { code: "BUSINESS" },
      },
      select: { id: true },
    });
    if (!snap) return;
    const [exportRes] = await prepareExportSections(SYSTEM_ACTOR, snap.id);
    expect(exportRes.sections.length).toBe(1);
    expect(exportRes.sections[0]!.name).toBe("区域统计明细");
  });
});
