// 锁住 exportToXlsx 的签名 + 实际产出有效的 xlsx
// 注: lib/excel.ts 返回的是 Node 20+ 的 Buffer<ArrayBufferLike>,
// exceljs 仍按老 Buffer 类型标注; runtime 无差别, 测试里加个 cast
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { exportToXlsx, exportMaxRows, attachmentHeader } from "@/lib/excel";

// exceljs 期望老 Buffer 类型, 而 exportToXlsx 返回的是 Buffer<ArrayBufferLike>
// 二者 runtime 等价, 这里 cast 一下
const asLegacyBuf = (b: Buffer): Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0] =>
  b as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0];

describe("exportMaxRows", () => {
  it("默认 5000 (1k 不再是上限, 默认已抬到 5k, 需要更大再显式设 EXPORT_MAX_ROWS)", () => {
    expect(exportMaxRows()).toBe(5000);
  });

  it("接受环境变量", () => {
    process.env.EXPORT_MAX_ROWS = "500";
    expect(exportMaxRows()).toBe(500);
    delete process.env.EXPORT_MAX_ROWS;
  });

  it("上限 10000, 防止误把 EXPORT_MAX_ROWS 设成 100 万", () => {
    process.env.EXPORT_MAX_ROWS = "1000000";
    expect(exportMaxRows()).toBe(10000);
    delete process.env.EXPORT_MAX_ROWS;
  });

  it("非法值回退到 5000", () => {
    process.env.EXPORT_MAX_ROWS = "abc";
    expect(exportMaxRows()).toBe(5000);
    delete process.env.EXPORT_MAX_ROWS;
  });
});

describe("exportToXlsx", () => {
  it("产出可被 exceljs 读回的有效 xlsx (表头 + 数据)", async () => {
    const rows = [
      { name: "张三", amount: 123.45 },
      { name: "李四", amount: 678.9 },
    ];
    const buf = await exportToXlsx(
      rows as unknown as Record<string, unknown>[],
      [
        { header: "姓名", key: "name", width: 20 },
        {
          header: "金额",
          key: "amount",
          width: 14,
          formatter: (v) => Number(v).toFixed(2),
        },
      ],
    );
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(asLegacyBuf(buf));
    const ws = wb.getWorksheet("Sheet1")!;
    expect(ws).toBeDefined();
    expect(ws.rowCount).toBe(3); // 1 header + 2 data
    expect(ws.getRow(1).getCell(1).value).toBe("姓名");
    expect(ws.getRow(1).getCell(2).value).toBe("金额");
    // formatter 走通了
    expect(ws.getRow(2).getCell(2).value).toBe("123.45");
    expect(ws.getRow(3).getCell(2).value).toBe("678.90");
  });

  it("空 rows 也能产出只有表头的 xlsx", async () => {
    const buf = await exportToXlsx(
      [] as Record<string, unknown>[],
      [{ header: "列1", key: "k", width: 10 }],
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(asLegacyBuf(buf));
    const ws = wb.getWorksheet("Sheet1")!;
    expect(ws.rowCount).toBe(1);
    expect(ws.getRow(1).getCell(1).value).toBe("列1");
  });

  it("无 formatter 时直接写原值 (空值写成空串)", async () => {
    const buf = await exportToXlsx(
      [
        { a: 1, b: null as unknown as number },
        { a: 2, b: "x" },
      ] as unknown as Record<string, unknown>[],
      [
        { header: "A", key: "a" },
        { header: "B", key: "b" },
      ],
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(asLegacyBuf(buf));
    const ws = wb.getWorksheet("Sheet1")!;
    expect(ws.getRow(2).getCell(1).value).toBe(1);
    // null/undefined 兜底成 ""
    expect(ws.getRow(2).getCell(2).value).toBe("");
    expect(ws.getRow(3).getCell(2).value).toBe("x");
  });
});


describe("attachmentHeader", () => {
  // 锁住 RFC 5987 编码:中文文件名不能用裸的 filename=,否则 Node 的 Headers 会抛
  // "Cannot convert argument to a ByteString" 把整个导出打成 500。
  it("中文文件名:同时输出 ASCII 兜底和 filename*=UTF-8'' 形式", () => {
    const h = attachmentHeader("区域统计_2026-06-28.xlsx");
    // 兜底:非 ASCII 全部替换成下划线
    expect(h).toContain('filename="_____2026-06-28.xlsx"');
    // RFC 5987: 百分号编码的 UTF-8
    expect(h).toContain("filename*=UTF-8''");
    expect(h).toContain(encodeURIComponent("区域统计_2026-06-28.xlsx"));
  });

  it("纯 ASCII 文件名:不引入百分号编码", () => {
    const h = attachmentHeader("report_2026.xlsx");
    expect(h).toBe(`attachment; filename="report_2026.xlsx"; filename*=UTF-8''report_2026.xlsx`);
  });

  it("带空格的文件名:空格被 encodeURIComponent 编码为 %20", () => {
    const h = attachmentHeader("Top 客户.xlsx");
    expect(h).toContain("filename*=UTF-8''Top%20%E5%AE%A2%E6%88%B7.xlsx");
  });

  it("始终以 attachment; 开头 (告诉浏览器下载而非内联)", () => {
    expect(attachmentHeader("x.xlsx")).toMatch(/^attachment;/);
  });
});
