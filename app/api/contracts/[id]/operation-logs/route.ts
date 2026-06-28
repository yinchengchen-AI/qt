// 合同维度的操作日志
// 业务逻辑全部在 server/services/contract/operation-logs.ts;本文件只做 HTTP 装配.
import { z } from "zod";
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { getContractOperationLogs } from "@/server/services/contract";

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const url = new URL(req.url);
      const p = query.parse(Object.fromEntries(url.searchParams));
      const data = await getContractOperationLogs(user, id, {
        page: p.page,
        pageSize: p.pageSize,
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
