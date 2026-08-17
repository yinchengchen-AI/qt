// 银行流水文本/文件解析测试
//   - parseDelimitedText: CSV / Excel 复制的 TSV
//   - parseStatementFile: .csv / .xlsx 文件 → 行记录
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseDelimitedText } from "@/lib/statement-text";
import { parseStatementFile } from "@/server/services/reconciliation";

describe("parseDelimitedText", () => {
  it("解析 TSV（从 Excel 直接复制）", () => {
    const text = "流水号\t交易日期\t金额\t对方户名\nA001\t2026-08-20\t50000.00\t杭州某某科技\nA002\t2026-08-21\t100\t宁波某某公司";
    const rows = parseDelimitedText(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ 流水号: "A001", 交易日期: "2026-08-20", 金额: "50000.00", 对方户名: "杭州某某科技" });
  });

  it("解析 CSV（含引号包裹的逗号字段）", () => {
    const text = '流水号,交易日期,金额,摘要\nA001,2026-08-20,"50,000.00","合同款, 第一期"';
    const rows = parseDelimitedText(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ 流水号: "A001", 金额: "50,000.00", 摘要: "合同款, 第一期" });
  });

  it("剥掉 BOM", () => {
    const rows = parseDelimitedText("﻿流水号,交易日期,金额\nA001,2026-08-20,100");
    expect(rows[0]).toMatchObject({ 流水号: "A001" });
  });

  it("只有表头返回空数组", () => {
    expect(parseDelimitedText("流水号,交易日期,金额")).toEqual([]);
    expect(parseDelimitedText("")).toEqual([]);
  });
});

describe("parseStatementFile", () => {
  it("解析 .csv 文件", async () => {
    const buf = Buffer.from("流水号,交易日期,金额\nA001,2026-08-20,50000.00", "utf-8");
    const rows = await parseStatementFile(buf, "statement.csv");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ 流水号: "A001", 金额: "50000.00" });
  });

  it("解析 .xlsx 文件（日期单元格转 YYYY-MM-DD）", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("S1");
    ws.addRow(["流水号", "交易日期", "金额", "对方户名"]);
    ws.addRow(["A001", new Date("2026-08-20T00:00:00Z"), 50000, "杭州某某科技"]);
    ws.addRow(["A002", "2026-08-21", 100.5, "宁波某某公司"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const rows = await parseStatementFile(buf, "statement.xlsx");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ 流水号: "A001", 交易日期: "2026-08-20", 金额: "50000", 对方户名: "杭州某某科技" });
    expect(rows[1]).toMatchObject({ 流水号: "A002", 金额: "100.5" });
  });

  it("空数据文件抛错", async () => {
    const buf = Buffer.from("流水号,交易日期,金额", "utf-8");
    await expect(parseStatementFile(buf, "empty.csv")).rejects.toThrow(/没有数据行/);
  });

  it("不支持的扩展名抛错", async () => {
    await expect(parseStatementFile(Buffer.from("x"), "a.pdf")).rejects.toThrow(/仅支持/);
  });
});
