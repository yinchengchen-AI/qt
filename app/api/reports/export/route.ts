import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { exportToXlsx, attachmentHeader } from "@/lib/excel";
import { prepareExportRows } from "@/server/services/report";

const query = z.object({
  snapshotId: z.string(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));

      const { definition, rows, columns, labelMap } = await prepareExportRows(user, parsed.snapshotId);
      const ts = new Date().toISOString().slice(0, 10);
      const filename = `${definition.name}_${definition.type}_${ts}.xlsx`;

      const excelColumns = columns.map((key) => ({
        header: labelMap[key] ?? key,
        key,
        width: 18,
        formatter: (v: unknown) => {
          if (v == null) return "";
          if (typeof v === "number") {
            const lowerKey = key.toLowerCase();
            if (lowerKey.includes("count") || lowerKey.includes("days") || lowerKey.includes("invoicecount") || lowerKey.includes("customercount")) {
              return String(v);
            }
            if (lowerKey.includes("rate") || lowerKey.includes("ratio")) {
              return `${v.toFixed(2)}%`;
            }
            return Number(v).toFixed(2);
          }
          return String(v);
        },
      }));

      const buf = await exportToXlsx(rows, excelColumns);
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
