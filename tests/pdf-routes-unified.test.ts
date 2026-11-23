// 5 个 PDF 打印路由(客户/合同/发票/回款/业绩排行)统一走 lib/print-html 模板 + pf* 格式化。
// 本文件钉死字段级约定, 防止后续加字段时又出现裸值 / 伪造占位行等不一致写法。
// 约定: 可空文本一律 pfText (空 → "—"), 空列表一律 emptyText 占位。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf-8");

describe("PDF 打印路由字段格式统一", () => {
  it("发票 PDF: 抬头名称等可空文本走 pfText, 空值渲染 —", () => {
    const src = read("app/api/invoices/[id]/pdf/route.ts");
    expect(src).toMatch(/pfText\(inv\.titleName\)/);
  });

  it("发票 PDF: 回款记录空数据走 emptyText, 不再伪造 (无) 占位行", () => {
    const src = read("app/api/invoices/[id]/pdf/route.ts");
    expect(src).toMatch(/emptyText:\s*"\(暂无回款记录\)"/);
    expect(src).not.toMatch(/label:\s*"\(无\)"/);
  });

  it("合同 PDF: 付款方式/状态枚举回退包 pfText, 空值不再渲染空白格", () => {
    const src = read("app/api/contracts/[id]/pdf/route.ts");
    expect(src).toMatch(/pfText\(PAYMENT_METHOD_MAP\[c\.paymentMethod\]/);
    expect(src).toMatch(/pfText\(CONTRACT_STATUS_MAP\[c\.status\]/);
  });

  it("模板已删 footer 字段: 路由不再传 footer", () => {
    for (const p of [
      "app/api/customers/[id]/pdf/route.ts",
      "app/api/contracts/[id]/pdf/route.ts",
      "app/api/invoices/[id]/pdf/route.ts",
      "app/api/payments/[id]/pdf/route.ts",
      "app/api/statistics/performance/pdf/route.ts",
    ]) {
      expect(read(p)).not.toMatch(/\bfooter\s*:/);
    }
  });
});
