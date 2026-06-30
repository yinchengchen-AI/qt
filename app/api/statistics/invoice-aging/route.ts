// 应收账龄分析(扩展版)
//   - 老字段 { buckets, total, rows } 保持, dashboard 不动
//   - 新增 query 参数 basis / customerId / ownerUserId / contractId / buckets / minAmount / page / pageSize / sort
//   - 新增响应字段 summary / byCustomer / byOwner / pagination / basisUsed
import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getInvoiceAging } from "@/server/services/statistics";

const BUCKET_VALUES = ["0-30", "31-60", "61-90", "90+"] as const;
const SORT_VALUES = ["daysOverdue:desc", "amount:desc", "customerName:asc"] as const;

const query = z.object({
  basis: z.enum(["issue", "due"]).optional(),
  customerId: z.string().optional(),
  ownerUserId: z.string().optional(),
  contractId: z.string().optional(),
  buckets: z.string().optional(), // 逗号分隔,如 "0-30,31-60"
  minAmount: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  sort: z.enum(SORT_VALUES).optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const buckets = parsed.buckets
        ? parsed.buckets.split(",").map((s) => s.trim()).filter((s): s is (typeof BUCKET_VALUES)[number] =>
            (BUCKET_VALUES as readonly string[]).includes(s)
          )
        : undefined;
      const minAmount = parsed.minAmount ? Number(parsed.minAmount) : undefined;
      const page = parsed.page ? Number(parsed.page) : undefined;
      const pageSize = parsed.pageSize ? Number(parsed.pageSize) : undefined;
      const data = await getInvoiceAging(user, {
        basis: parsed.basis,
        customerId: parsed.customerId,
        ownerUserId: parsed.ownerUserId,
        contractId: parsed.contractId,
        buckets,
        minAmount,
        page,
        pageSize,
        sort: parsed.sort
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
