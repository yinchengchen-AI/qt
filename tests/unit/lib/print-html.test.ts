import { describe, expect, it } from "vitest";
import { renderPrintHtml, type PrintDoc } from "@/lib/print-html";

const baseDoc: PrintDoc = {
  title: "合同 - HT001",
  subtitle: "测试合同 · 客户: 某某公司",
  periodLabel: "2026-11",
  meta: [{ label: "合同号:", value: "HT001" }],
  mainRows: [
    { label: "合同标题", value: "测试合同" },
    { label: "签订日", value: "2026-06-09" },
  ],
};

describe("lib/print-html 统一 PDF 打印模板", () => {
  it("渲染品牌 header: LOGO + 系统名 + 标题 + 副标题 + meta + 打印时间", () => {
    const html = renderPrintHtml(baseDoc);
    expect(html).toContain("brand-header");
    expect(html).toContain('src="/qitai-logo.svg"');
    expect(html).toContain("杭州企泰安全科技 业务管理系统");
    expect(html).toContain("合同 - HT001");
    expect(html).toContain("测试合同 · 客户: 某某公司");
    expect(html).toContain("HT001");
    expect(html).toContain("打印时间:");
  });

  it("渲染主信息 KV 表", () => {
    const html = renderPrintHtml(baseDoc);
    expect(html).toContain('class="kv"');
    expect(html).toContain("合同标题");
    expect(html).toContain("测试合同");
  });

  it("渲染汇总卡片, 按 tone 出 class", () => {
    const html = renderPrintHtml({
      ...baseDoc,
      summary: [
        { label: "合同总额", value: "¥1,234.00", tone: "primary" },
        { label: "已回款", value: "¥0.00" },
      ],
    });
    expect(html).toContain("summary-grid");
    expect(html).toContain("summary-card--primary");
    expect(html).toContain("¥1,234.00");
    // 未指定 tone 时回落 default
    expect(html).toContain("summary-card--default");
  });

  it("渲染富表节: 表头/行 + rowClass/cellClass 钩子", () => {
    const html = renderPrintHtml({
      ...baseDoc,
      sections: [
        {
          title: "开票记录",
          columns: ["发票号", "金额"],
          rows: [
            { 发票号: "INV-1", 金额: "¥10.00" },
            { 发票号: "合计", 金额: "¥10.00" },
          ],
          rowClass: (row) => (row["发票号"] === "合计" ? "total" : undefined),
          cellClass: (column) => (column === "金额" ? "amount" : undefined),
          emptyText: "暂无开票记录",
        },
      ],
    });
    expect(html).toContain("print-section");
    expect(html).toContain("开票记录");
    expect(html).toContain("<th>发票号</th>");
    expect(html).toContain('class="total"');
    expect(html).toContain('class="amount"');
  });

  it("富表空数据 → emptyText 占位", () => {
    const html = renderPrintHtml({
      ...baseDoc,
      sections: [
        {
          title: "开票记录",
          columns: ["发票号"],
          rows: [],
          emptyText: "暂无开票记录",
        },
      ],
    });
    expect(html).toContain("暂无开票记录");
  });

  it("KV 节空数据 → emptyText 占位", () => {
    const html = renderPrintHtml({
      ...baseDoc,
      sections: [{ title: "审批记录", rows: [], emptyText: "暂无审批记录" }],
    });
    expect(html).toContain("暂无审批记录");
  });

  it("默认渲染签字区, signature:false 时隐藏", () => {
    expect(renderPrintHtml(baseDoc)).toContain("signature");
    expect(renderPrintHtml({ ...baseDoc, signature: false })).not.toContain(
      'class="signature"',
    );
  });

  it("默认 A4 纵向, landscape 出横向 @page", () => {
    expect(renderPrintHtml(baseDoc)).toContain("size: A4 portrait");
    expect(renderPrintHtml({ ...baseDoc, orientation: "landscape" })).toContain(
      "size: A4 landscape",
    );
  });

  it("文档值转义 HTML, 防注入", () => {
    const html = renderPrintHtml({
      ...baseDoc,
      mainRows: [{ label: "备注", value: '<script>alert(1)</script>' }],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("不残留已删除的旧报表样式 (signer-detail)", () => {
    const html = renderPrintHtml(baseDoc);
    expect(html).not.toContain("signer-detail");
    expect(html).not.toContain("signer-subtotal");
    expect(html).not.toContain("signer-total");
  });

  it("不残留 legacy-footer 页脚样式", () => {
    const html = renderPrintHtml(baseDoc);
    expect(html).not.toContain("legacy-footer");
  });
});
