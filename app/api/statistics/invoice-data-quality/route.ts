// 统计模块:发票数据质量异常数据
import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getInvoiceDataQualityIssues } from "@/server/services/invoice-data-quality";

const query = z.object({
  issueCode: z.string().optional(),
  status: z.enum(["OPEN", "RESOLVED"]).optional(),
  keyword: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const data = await getInvoiceDataQualityIssues(user, {
        issueCode: parsed.issueCode,
        status: parsed.status,
        keyword: parsed.keyword,
        page: parsed.page ? Number(parsed.page) : undefined,
        pageSize: parsed.pageSize ? Number(parsed.pageSize) : undefined
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
