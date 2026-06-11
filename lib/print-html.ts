// 详情页"导出 PDF"用的打印页模板:服务端用同一份数据渲染一个独立 HTML 页面,
// 新窗口打开后自动 window.print()。用户在浏览器打印对话框里选"另存为 PDF"即可。
// 用 inline CSS + system font 保证打印时不依赖任何外部资源,中文字体走系统默认。
export type PrintRow = { label: string; value: string | number | null | undefined };
export type PrintSection = { title: string; rows: PrintRow[] };
export type PrintDoc = {
  /** 顶部大字,通常是资源名 + 编号 */
  title: string;
  /** 副标题,通常是客户/关联单据 */
  subtitle?: string;
  /** 主要字段组(基本信息) */
  mainRows: PrintRow[];
  /** 扩展字段组(关联信息/明细) */
  sections?: PrintSection[];
  /** 页脚,通常"打印人 / 打印时间" */
  footer?: PrintRow[];
  /** 系统名,显示在 header */
  systemName?: string;
};

function esc(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function rowHtml(r: PrintRow): string {
  return `
    <tr>
      <th>${esc(r.label)}</th>
      <td>${esc(r.value ?? "")}</td>
    </tr>`;
}

function sectionHtml(s: PrintSection): string {
  return `
    <div class="section">
      <h2>${esc(s.title)}</h2>
      <table class="kv">
        <tbody>${s.rows.map(rowHtml).join("")}</tbody>
      </table>
    </div>`;
}

export function renderPrintHtml(doc: PrintDoc): string {
  const sys = doc.systemName ?? "杭州企泰安全科技 业务管理系统";
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${esc(doc.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
                   "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif;
      color: #222;
      margin: 0;
      padding: 24px 32px;
      font-size: 12px;
      line-height: 1.6;
    }
    .header {
      border-bottom: 2px solid #1d39c4;
      padding-bottom: 12px;
      margin-bottom: 20px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .header .sys { font-size: 11px; color: #888; }
    .header .doc-title { font-size: 18px; font-weight: 600; color: #1d39c4; margin-top: 4px; }
    .header .doc-sub { font-size: 12px; color: #666; margin-top: 2px; }
    .header .meta { font-size: 11px; color: #888; text-align: right; }
    table.kv {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    table.kv th, table.kv td {
      border: 1px solid #e8e8e8;
      padding: 6px 10px;
      text-align: left;
      vertical-align: top;
    }
    table.kv th {
      background: #fafafa;
      color: #555;
      font-weight: 500;
      width: 18%;
      white-space: nowrap;
    }
    table.kv td { width: 32%; word-break: break-word; }
    .section h2 {
      font-size: 13px;
      font-weight: 600;
      color: #1d39c4;
      border-left: 3px solid #1d39c4;
      padding-left: 8px;
      margin: 18px 0 10px;
    }
    .footer {
      margin-top: 30px;
      padding-top: 10px;
      border-top: 1px solid #e8e8e8;
      color: #888;
      font-size: 11px;
      text-align: right;
    }
    .footer table { margin-left: auto; }
    .footer th { background: transparent; border: 0; color: #888; }
    .footer td { border: 0; }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
      @page { margin: 16mm; size: A4; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="sys">${esc(sys)}</div>
      <div class="doc-title">${esc(doc.title)}</div>
      ${doc.subtitle ? `<div class="doc-sub">${esc(doc.subtitle)}</div>` : ""}
    </div>
    <div class="meta">打印时间: ${esc(new Date().toLocaleString("zh-CN"))}</div>
  </div>

  <table class="kv">
    <tbody>${doc.mainRows.map(rowHtml).join("")}</tbody>
  </table>

  ${(doc.sections ?? []).map(sectionHtml).join("")}

  ${
    doc.footer && doc.footer.length
      ? `<div class="footer">
          <table class="kv">
            <tbody>${doc.footer.map(rowHtml).join("")}</tbody>
          </table>
        </div>`
      : ""
  }

  <div class="no-print" style="margin-top: 20px; text-align: center; color: #999; font-size: 11px;">
    请在浏览器打印对话框中选择"另存为 PDF"。
  </div>
  <script>
    // 内容加载完成后自动唤起打印对话框;用户取消不报错
    window.addEventListener("load", function () {
      setTimeout(function () { try { window.print(); } catch (e) {} }, 300);
    });
  </script>
</body>
</html>`;
}
