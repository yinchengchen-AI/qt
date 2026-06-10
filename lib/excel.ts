// 简单 xlsx 导出：用 exceljs 流式生成
import ExcelJS from "exceljs";

export type ExcelColumn<T> = { header: string; key: keyof T | string; width?: number; formatter?: (v: unknown, row: T) => string | number };

export async function exportToXlsx<T extends Record<string, unknown>>(
  rows: T[],
  columns: ExcelColumn<T>[],
  _filename: string
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key as string, width: c.width ?? 18 }));
  // 表头加粗
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: "middle", horizontal: "left" };
  for (const r of rows) {
    const row: Record<string, unknown> = {};
    for (const c of columns) {
      const raw = (r as Record<string, unknown>)[c.key as string];
      row[c.key as string] = c.formatter ? c.formatter(raw, r) : (raw ?? "");
    }
    ws.addRow(row);
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
