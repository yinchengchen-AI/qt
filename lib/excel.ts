// 简单 xlsx 导出: 用 exceljs 流式生成
// 安全注意: 调用方必须自行限制 rows 长度, 防止单次请求拉百万行导致 OOM
import ExcelJS from "exceljs";

// 导出路由单次请求允许的最大行数 (可通过 EXPORT_MAX_ROWS 调整, 硬上限 10000 防止 OOM)
// - 默认 5000: 覆盖常见 1k-5k 量级的列表导出; 真要再大就显式设 EXPORT_MAX_ROWS=10000
export function exportMaxRows(): number {
  const n = Number(process.env.EXPORT_MAX_ROWS ?? "5000");
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000) : 5000;
}

export type ExcelColumn<T> = {
  header: string;
  key: keyof T | string;
  width?: number;
  formatter?: (v: unknown, row: T) => string | number;
};

export async function exportToXlsx<T extends Record<string, unknown>>(
  rows: T[],
  columns: ExcelColumn<T>[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key as string,
    width: c.width ?? 18,
  }));
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

/**
 * 多 sheet 导出: 一个函数可包含多个独立的数据段
 * (例如 PERFORMANCE: 员工业绩汇总 + 签约明细)。
 * - 每个 section 独立 sheet, 表头加粗
 * - 单 sheet 内不强制列宽 (用各 column 的 width); 多个 sheet 不做跨表合计
 *   (跨表合计在 web 端用 Table.Summary 渲染, 导出场景单独 sheet 已经清晰)
 */
export type ExcelSheet<T = Record<string, unknown>> = {
  name: string;
  rows: T[];
  columns: ExcelColumn<T>[];
};

export async function exportToMultiSheetXlsx(
  sheets: ExcelSheet[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const safeName = sheet.name.replace(/[\\/?*\[\]:]/g, "_").slice(0, 31) || "Sheet";
    const ws = wb.addWorksheet(safeName);
    ws.columns = sheet.columns.map((c) => ({
      header: c.header,
      key: c.key as string,
      width: c.width ?? 18,
    }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: "middle", horizontal: "left" };
    for (const r of sheet.rows) {
      const row: Record<string, unknown> = {};
      for (const c of sheet.columns) {
        const raw = (r as Record<string, unknown>)[c.key as string];
        row[c.key as string] = c.formatter ? c.formatter(raw, r) : (raw ?? "");
      }
      ws.addRow(row);
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}


/**
 * 构造带中文文件名的 Content-Disposition 值 (RFC 5987)。
 *
 * 背景:HTTP 头只能放 ASCII;若把 "区域统计_2026-06-28.xlsx" 直接塞进
 * Content-Disposition,Node 的 Headers 实现会抛
 *   "Cannot convert argument to a ByteString because the character at index 22 has a value of 21306"
 * 整个请求被 try/catch 兜成 500。本 helper 同时输出 ASCII 兜底 (filename=) 和
 * RFC 5987 UTF-8 形式 (filename*=),现代浏览器都看 filename*,老 IE 拿 filename=。
 *
 * @param filename 期望用户看到的下载文件名,支持中文/空格
 * @returns 可直接放进 Response headers 的 Content-Disposition 字符串
 */
export function attachmentHeader(filename: string): string {
  // ASCII 兜底:把非 ASCII/非可打印 ASCII 替换成下划线,避免老客户端拿到乱码
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
