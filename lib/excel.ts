// 简单 xlsx 导出：用 exceljs 流式生成
// 安全注意: 调用方必须自行限制 rows 长度,防止单次请求拉百万行导致 OOM
import ExcelJS from "exceljs";

// 导出路由单次请求允许的最大行数(可通过 EXPORT_MAX_ROWS 调整,生产建议 1000-5000)
export function exportMaxRows(): number {
  const n = Number(process.env.EXPORT_MAX_ROWS ?? "1000");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 1000;
}


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
