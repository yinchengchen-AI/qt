import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { exportToMultiSheetXlsx, attachmentHeader } from "@/lib/excel";
import {
  prepareExportSections,
  prepareLiveExport,
  type ExportSection,
} from "@/server/services/report";
import { parseDateRangeQuery, exportFileTimestamp} from "@/lib/date-range";

// query 支持两种模式:
//   1) snapshotId -> 走快照
//   2) code + periodType (+ from/to for CUSTOM) -> 实时查询导出
//      用于 CUSTOM 周期 (不走快照) 的导出
const query = z
  .object({
    snapshotId: z.string().optional(),
    code: z.string().optional(),
    periodType: z.enum(["MONTH", "QUARTER", "YEAR", "CUSTOM"]).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .refine(
    (v) => Boolean(v.snapshotId) || (Boolean(v.code) && Boolean(v.periodType)),
    { message: "需要 snapshotId 或 (code + periodType) 其中之一" }
  );

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));

      const result = parsed.snapshotId
        ? await prepareExportSections(user, parsed.snapshotId)
        : await prepareLiveExport(
            user,
            parsed.code!,
            parsed.periodType!,
            parsed.periodType === "CUSTOM" ? parseDateRangeQuery({ from: parsed.from, to: parsed.to }) : undefined
          );
      const { definition, sections } = result;
      // 文件名: snapshot 走 periodLabel, 实时查询走 periodType + 日期范围
      // ts 用 YYYY-MM-DD_HHMM 格式, 避免同日多次导出覆盖
      const ts = exportFileTimestamp();
      const periodTag = parsed.snapshotId
        ? definition.type
        : `${parsed.periodType}_${parsed.from?.slice(0, 10) ?? ""}_${parsed.to?.slice(0, 10) ?? ""}`;
      const filename = `${definition.name}_${periodTag}_${ts}.xlsx`;

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
