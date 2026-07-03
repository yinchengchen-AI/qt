import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { exportToMultiSheetXlsx, attachmentHeader } from "@/lib/excel";
import { prepareExportSections, type ExportSection } from "@/server/services/report";

const query = z.object({
  snapshotId: z.string(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));

      const { definition, sections } = await prepareExportSections(user, parsed.snapshotId);
      const ts = new Date().toISOString().slice(0, 10);
      const filename = `${definition.name}_${definition.type}_${ts}.xlsx`;

      // PERFORMANCE 等多 sheet 类型: 每个 section 一个 sheet;
      // 其它类型: 1 个 sheet(保留老行为)
      // 行数为 0 的 section 跳过, 避免空表
      // 构造 ExcelSheet; 这里的 c.formatter 是 ExcelColumn 里的 (v: unknown, row: T) => ...
      // 多 sheet 版本里第二参用不上, 直接转成 (v: unknown) => string | number
      const sheets: Array<{ name: string; rows: Record<string, unknown>[]; columns: Array<{ header: string; key: string; width?: number; formatter?: (v: unknown) => string | number }> }> = sections
        .filter((s: ExportSection) => s.rows.length > 0)
        .map((s: ExportSection) => ({
          name: s.name,
          rows: s.rows,
          columns: s.columns.map((c) => ({
            header: c.header,
            key: c.key,
            width: c.width ?? 18,
            formatter: c.formatter
              ? ((v: unknown) => c.formatter!(v))
              : undefined,
          })),
        }));
      if (sheets.length === 0) {
        // 没有任何数据: 写一个 "无数据" sheet 占位, 避免 xlsx 完全空文件
        sheets.push({ name: "无数据", rows: [{ 提示: "当前周期内没有可导出的明细" }], columns: [{ header: "提示", key: "提示", width: 30 }] } as (typeof sheets)[number]);
      }
      const buf = await exportToMultiSheetXlsx(sheets);
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": attachmentHeader(filename),
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return err(e);
    }
  });
}
