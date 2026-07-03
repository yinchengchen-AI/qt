// 详情页"导出 PDF"用的打印页模板。
// 设计要点:
// - 服务端用同一份数据渲染一个独立 HTML 页面,新窗口打开后自动 window.print(),
//   用户在浏览器打印对话框里选"另存为 PDF"即可。
// - 用 inline CSS + system font,中文字体走系统默认。
// - LOGO + 品牌色(#0A1C33 / #E11A2A)取自 public/qitai-logo.svg
// - 支持 KV 表(主信息)、汇总卡片(财务高亮)、富表(列表/明细)、签字占位
// - 长内容用 page-break-inside: avoid 切分,避免撑破单页

import { exportFileTimestamp } from "@/lib/date-range";

export type PrintRow = { label: string; value: string | number | null | undefined };

export type PrintSummaryItem = {
  label: string;
  value: string;
  /** 默认中性, primary 蓝(主调), success 绿, warning 橙, danger 红 */
  tone?: "default" | "primary" | "success" | "warning" | "danger";
};

/** 富表分节(用于合同/开票/回款等列表) */
export type PrintTableSection = {
  title: string;
  columns: string[];
  /** 单元格 key 对应 columns 中同名元素;值里可塞 HTML(模板里已 esc) */
  rows: Array<Record<string, string | number | null | undefined>>;
  emptyText?: string;
  /**
   * 自定义 <table> 的 class (拼接在 "grid" 后面),
   * 例如 "signer-detail" 会渲染成 <table class="grid signer-detail">
   */
  tableClass?: string;
  /**
   * 行级别 class 钩子,根据当前行返回 class 字符串 (会拼到 <tr class="...">)
   * 配合 tableClass 用, 例如签约人小计/合计行高亮
   */
  rowClass?: (row: Record<string, string | number | null | undefined>) => string | undefined;
  /**
   * 单元格级别 class 钩子,根据 (列名, 值) 返回 class 字符串 (会拼到 <td class="...">)
   * 配合 tableClass 用, 例如金额列右对齐
   */
  cellClass?: (column: string, value: unknown) => string | undefined;
};

/** 键值表分节(用于审批记录/跟进记录等) */
export type PrintKvSection = {
  title: string;
  rows: PrintRow[];
  emptyText?: string;
};

export type PrintSection = PrintKvSection | PrintTableSection;

export type PrintDoc = {
  /** 顶部大字,通常是资源名 + 编号 */
  title: string;
  /** 周期标签 (例如 "2026年5月" / "2026年Q3" / "2026-01-01 ~ 2026-01-31"),
   *  用作浏览器"另存为 PDF"默认文件名 + 内容页副标题 */
  periodLabel?: string;
  /** 副标题,通常是客户/关联单据 */
  subtitle?: string;
  /** header 右上小字:编号 / 创建人 / 创建时间等 */
  meta?: PrintRow[];
  /** 主要字段组(基本信息) */
  mainRows: PrintRow[];
  /** 财务汇总卡片(3-4 个并列),会渲染在 mainRows 之后 */
  summary?: PrintSummaryItem[];
  /** 扩展字段组(关联信息/明细) */
  sections?: PrintSection[];
  /** 文档备注/说明,放在主表下方,签名区上方 */
  note?: string;
  /** 页脚,通常"打印人 / 打印时间" */
  footer?: PrintRow[];
  /** 是否在底部显示签字占位区(默认 true) */
  signature?: boolean;
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

function isTable(s: PrintSection): s is PrintTableSection {
  return Array.isArray((s as PrintTableSection).columns);
}

function summaryClass(tone: PrintSummaryItem["tone"]): string {
  return `summary-card summary-card--${tone ?? "default"}`;
}

function renderKvRows(rows: PrintRow[]): string {
  return rows
    .map(
      (r) => `
    <tr>
      <th>${esc(r.label)}</th>
      <td>${esc(r.value ?? "")}</td>
    </tr>`
    )
    .join("");
}

function renderTable(s: PrintTableSection): string {
  if (!s.rows.length) {
    return `<div class="empty">${esc(s.emptyText ?? "(无)")}</div>`;
  }
  const tableClass = s.tableClass ? `grid ${esc(s.tableClass)}` : "grid";
  const head = `<thead><tr>${s.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${s.rows
    .map((r) => {
      const rowCls = s.rowClass ? s.rowClass(r) : undefined;
      const trAttr = rowCls ? ` class="${esc(rowCls)}"` : "";
      return `<tr${trAttr}>${s.columns
        .map((c) => {
          const cellCls = s.cellClass ? s.cellClass(c, r[c]) : undefined;
          const tdAttr = cellCls ? ` class="${esc(cellCls)}"` : "";
          return `<td${tdAttr}>${esc(r[c] ?? "")}</td>`;
        })
        .join("")}</tr>`;
    })
    .join("")}</tbody>`;
  return `<table class="${tableClass}">${head}${body}</table>`;
}

function renderKv(s: PrintKvSection): string {
  if (!s.rows.length) {
    return `<div class="empty">${esc(s.emptyText ?? "(无)")}</div>`;
  }
  return `<table class="kv"><tbody>${renderKvRows(s.rows)}</tbody></table>`;
}

function renderSection(s: PrintSection): string {
  const body = isTable(s) ? renderTable(s) : renderKv(s);
  return `<section class="print-section">
    <h2 class="section-title">${esc(s.title)}</h2>
    <div class="section-body">${body}</div>
  </section>`;
}

function renderSummary(items: PrintSummaryItem[]): string {
  return `<div class="summary-grid">
    ${items
      .map(
        (it) => `
      <div class="${summaryClass(it.tone)}">
        <div class="summary-label">${esc(it.label)}</div>
        <div class="summary-value">${esc(it.value)}</div>
      </div>`
      )
      .join("")}
  </div>`;
}

function renderMeta(rows: PrintRow[]): string {
  if (!rows.length) return "";
  return `<dl class="meta">${rows
    .map(
      (r) =>
        `<dt>${esc(r.label)}</dt><dd>${esc(r.value ?? "")}</dd>`
    )
    .join("")}</dl>`;
}

function renderSignature(): string {
  return `<div class="signature">
    <div class="sig-cell">
      <div class="sig-label">打印人</div>
      <div class="sig-line"></div>
    </div>
    <div class="sig-cell">
      <div class="sig-label">打印日期</div>
      <div class="sig-line"></div>
    </div>
    <div class="sig-cell">
      <div class="sig-label">审核签字</div>
      <div class="sig-line"></div>
    </div>
  </div>`;
}

export function renderPrintHtml(doc: PrintDoc): string {
  const sys = doc.systemName ?? "杭州企泰安全科技 业务管理系统";
  const showSig = doc.signature !== false;
  const stamp = new Date().toLocaleString("zh-CN");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${esc(doc.title)}${doc.periodLabel ? "_" + esc(doc.periodLabel) : ""}_${exportFileTimestamp()}</title>
  <style>
    :root {
      --brand-navy: #0A1C33;
      --brand-red: #E11A2A;
      --brand-blue: #1677ff;
      --ink-1: #1f2937;
      --ink-2: #4b5563;
      --ink-3: #6b7280;
      --line: #e5e7eb;
      --line-strong: #d1d5db;
      --bg-soft: #f8fafc;
      --bg-band: #f1f5f9;
      --tone-primary: #1677ff;
      --tone-primary-bg: #e6f4ff;
      --tone-success: #16a34a;
      --tone-success-bg: #dcfce7;
      --tone-warning: #d97706;
      --tone-warning-bg: #fef3c7;
      --tone-danger: #dc2626;
      --tone-danger-bg: #fee2e2;
      --tone-default: #374151;
      --tone-default-bg: #f3f4f6;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB",
                   "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif;
      color: var(--ink-1);
      padding: 18mm 16mm 22mm;
      font-size: 11.5px;
      line-height: 1.6;
      background: #fff;
    }

    /* 顶部品牌 header */
    .brand-header {
      display: flex;
      align-items: flex-start;
      gap: 16px;
      padding-bottom: 14px;
      border-bottom: 2px solid var(--brand-navy);
      margin-bottom: 18px;
    }
    .brand-header .logo { width: 132px; height: auto; flex: 0 0 auto; }
    .brand-header .title-block { flex: 1 1 auto; min-width: 0; }
    .brand-header .sys {
      font-size: 10.5px; color: var(--ink-3);
      letter-spacing: 1px; text-transform: uppercase;
    }
    .brand-header .doc-title {
      font-size: 22px; font-weight: 700; color: var(--brand-navy);
      margin-top: 6px; line-height: 1.25;
    }
    .brand-header .doc-sub {
      font-size: 12px; color: var(--ink-2); margin-top: 2px;
    }
    .brand-header .meta {
      flex: 0 0 auto; text-align: right; min-width: 160px;
      font-size: 11px; color: var(--ink-3);
    }
    .brand-header .meta dt { display: inline; font-weight: 500; }
    .brand-header .meta dd { display: inline; margin: 0 0 0 4px; }
    .brand-header .meta .meta-row { margin-top: 2px; }

    /* 主表(2 列 KV) */
    table.kv {
      width: 100%;
      border-collapse: collapse;
      margin: 0 0 14px;
    }
    table.kv th, table.kv td {
      border: 1px solid var(--line);
      padding: 6px 10px;
      text-align: left;
      vertical-align: top;
    }
    table.kv th {
      background: var(--bg-soft);
      color: var(--ink-2);
      font-weight: 500;
      width: 16%;
      white-space: nowrap;
    }
    table.kv td { width: 34%; word-break: break-word; }

    /* 汇总卡片(财务高亮) */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 10px;
      margin: 0 0 18px;
      page-break-inside: avoid;
    }
    .summary-card {
      border: 1px solid var(--line);
      border-left: 3px solid var(--tone-default);
      border-radius: 6px;
      padding: 10px 12px;
      background: var(--tone-default-bg);
    }
    .summary-card--primary { border-left-color: var(--tone-primary); background: var(--tone-primary-bg); }
    .summary-card--success { border-left-color: var(--tone-success); background: var(--tone-success-bg); }
    .summary-card--warning { border-left-color: var(--tone-warning); background: var(--tone-warning-bg); }
    .summary-card--danger  { border-left-color: var(--tone-danger);  background: var(--tone-danger-bg); }
    .summary-card .summary-label { font-size: 11px; color: var(--ink-3); }
    .summary-card .summary-value {
      font-size: 18px; font-weight: 700; color: var(--ink-1);
      margin-top: 2px; line-height: 1.2; word-break: break-all;
    }
    .summary-card--primary .summary-value { color: var(--tone-primary); }
    .summary-card--success .summary-value { color: var(--tone-success); }
    .summary-card--warning .summary-value { color: var(--tone-warning); }
    .summary-card--danger  .summary-value { color: var(--tone-danger); }

    /* 章节(色带标题 + 内容) */
    .print-section {
      margin-top: 16px;
      page-break-inside: avoid;
    }
    .print-section .section-title {
      font-size: 13px; font-weight: 700; color: #fff;
      background: var(--brand-navy);
      padding: 6px 12px;
      border-radius: 4px 4px 0 0;
      margin: 0;
      letter-spacing: 0.5px;
    }
    .print-section .section-body {
      border: 1px solid var(--line);
      border-top: 0;
      border-radius: 0 0 4px 4px;
      padding: 10px 12px;
      background: #fff;
    }
    .print-section .empty {
      color: var(--ink-3); font-style: italic; text-align: center; padding: 8px 0;
    }

    /* 富表(列表) */
    table.grid {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    table.grid th, table.grid td {
      border: 1px solid var(--line);
      padding: 5px 8px;
      text-align: left;
      vertical-align: top;
      word-break: break-word;
    }
    table.grid th {
      background: var(--bg-band);
      color: var(--ink-2);
      font-weight: 600;
      white-space: nowrap;
    }
    table.grid tr { page-break-inside: avoid; }

    /* 员工业绩明细 (PDF 5 字段 + 小计(万元)) — 跟原 PDF 模板视觉对齐 */
    table.grid.signer-detail { font-size: 11.5px; }
    table.grid.signer-detail th,
    table.grid.signer-detail td {
      padding: 6px 8px;
      border: 1.5px solid #1f2937;
    }
    table.grid.signer-detail th {
      background: #fff;
      color: #000;
      font-size: 12px;
      text-align: center;
      font-weight: 700;
    }
    /* 合同行: 金额右对齐 */
    table.grid.signer-detail td.amount,
    table.grid.signer-detail td.subtotal-wan {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    /* 签约人小计行: 浅灰底 + 加粗 */
    table.grid.signer-detail tr.signer-subtotal {
      background: #e5e7eb;
    }
    table.grid.signer-detail tr.signer-subtotal td {
      font-weight: 700;
    }
    /* 全公司合计行: 深灰底 + 加粗 */
    table.grid.signer-detail tr.signer-total {
      background: #d1d5db;
    }
    table.grid.signer-detail tr.signer-total td {
      font-weight: 700;
      font-size: 12px;
    }
    /* 签约人组内逐行交替底色 (浅黄/白) — 模拟原 PDF */
    table.grid.signer-detail tr.detail-row {
      background: #fffbe6;
    }

    /* 文档备注 */
    .doc-note {
      margin-top: 14px;
      padding: 10px 12px;
      background: var(--bg-soft);
      border-left: 3px solid var(--brand-blue);
      font-size: 11.5px;
      color: var(--ink-2);
      white-space: pre-wrap;
      page-break-inside: avoid;
    }
    .doc-note .doc-note-label {
      font-weight: 600; color: var(--brand-navy); margin-bottom: 2px;
    }

    /* 签字区 */
    .signature {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 24px;
      margin-top: 28px;
      page-break-inside: avoid;
    }
    .sig-cell .sig-label { font-size: 11px; color: var(--ink-3); }
    .sig-cell .sig-line {
      height: 36px; border-bottom: 1px solid var(--ink-1);
      margin-top: 4px;
    }

    /* 通用 footer 字段(老 API 兼容) */
    .legacy-footer {
      margin-top: 24px; padding-top: 10px;
      border-top: 1px solid var(--line);
      color: var(--ink-3); font-size: 11px;
    }
    .legacy-footer table { margin-left: auto; }
    .legacy-footer th { background: transparent; border: 0; color: var(--ink-3); font-weight: 500; }
    .legacy-footer td { border: 0; }

    /* 提示语(不打印) */
    .no-print-hint {
      margin-top: 20px; text-align: center; color: var(--ink-3);
      font-size: 11px;
    }

    /* @page + 打印规则 */
    @page { size: A4; margin: 0; }
    @media print {
      body { padding: 14mm 14mm 18mm; }
      .no-print-hint { display: none; }
    }
  </style>
</head>
<body>
  <header class="brand-header">
    <img class="logo" src="/qitai-logo.svg" alt="QITAI SAFETY" />
    <div class="title-block">
      <div class="sys">${esc(sys)}</div>
      <div class="doc-title">${esc(doc.title)}</div>
      ${doc.subtitle ? `<div class="doc-sub">${esc(doc.subtitle)}</div>` : ""}
    </div>
    ${doc.meta && doc.meta.length ? `<div class="meta">${renderMeta(doc.meta)}<div class="meta-row">打印时间: ${esc(stamp)}</div></div>` : `<div class="meta"><div class="meta-row">打印时间: ${esc(stamp)}</div></div>`}
  </header>

  <table class="kv">
    <tbody>${renderKvRows(doc.mainRows)}</tbody>
  </table>

  ${doc.summary && doc.summary.length ? renderSummary(doc.summary) : ""}

  ${(doc.sections ?? []).map(renderSection).join("")}

  ${doc.note ? `<div class="doc-note"><div class="doc-note-label">备注</div>${esc(doc.note)}</div>` : ""}

  ${
    doc.footer && doc.footer.length
      ? `<div class="legacy-footer">
          <table class="kv">
            <tbody>${renderKvRows(doc.footer)}</tbody>
          </table>
        </div>`
      : ""
  }

  ${showSig ? renderSignature() : ""}

  <div class="no-print-hint">请在浏览器打印对话框中选择"另存为 PDF"。</div>
  <script>
    // 内容加载完成后自动唤起打印对话框;用户取消不报错
    window.addEventListener("load", function () {
      // 等待图片(LOGO)加载完成,避免打印时缺图
      var imgs = Array.prototype.slice.call(document.images || []);
      Promise.all(imgs.map(function (img) {
        if (img.complete) return Promise.resolve();
        return new Promise(function (r) { img.onload = img.onerror = r; });
      })).then(function () {
        setTimeout(function () { try { window.print(); } catch (e) {} }, 300);
      });
    });
  </script>
</body>
</html>`;
}
