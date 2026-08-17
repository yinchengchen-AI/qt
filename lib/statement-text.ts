// 银行流水"分隔文本"解析（CSV / 从 Excel 直接复制的 TSV）。
// 前后端共用: 服务端用于 .csv 文件导入, 前端用于粘贴区解析。
// 约定: 第一行是表头（流水号 / 交易日期 / 金额 / ...）, 之后每行一条流水。

/** 按 CSV 规则拆一行（支持双引号包裹、"" 转义）; delim 支持逗号或制表符 */
export function splitDelimitedLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * 把 CSV/TSV 文本解析为 Record<表头, 单元格> 数组。
 * 自动识别分隔符: 表头含制表符按 TSV, 否则按逗号。
 * 返回空数组表示没有数据行。
 */
export function parseDelimitedText(text: string): Array<Record<string, unknown>> {
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const delim = lines[0]!.includes("\t") ? "\t" : ",";
  const headers = splitDelimitedLine(lines[0]!, delim).filter((h) => h.length > 0);
  const rows: Array<Record<string, unknown>> = [];
  for (const line of lines.slice(1)) {
    const cells = splitDelimitedLine(line, delim);
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    rows.push(row);
  }
  return rows;
}
