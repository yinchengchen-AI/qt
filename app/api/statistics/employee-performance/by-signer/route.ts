// 员工业绩明细（按签约人维度）
// 用途：员工业绩页面主表格数据源。与 /api/statistics/employee-performance (owner 维度, 仍供 xlsx 导出使用)
// 不同的是: 本端点按 signerId 聚合, 字段结构与页面 Row 类型完全一致, 零类型转换即可消费。
import { z } from "zod";
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { resolveDateRangeQuery } from "@/lib/date-range";
import { getSignerSummary } from "@/server/services/statistics";

const query = z.object({
  from: z.string().optional(),
  to: z.string().optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const range = resolveDateRangeQuery(parsed);
      const data = await getSignerSummary(user, range);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
