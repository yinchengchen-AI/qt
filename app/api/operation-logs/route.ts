// 操作日志查询（仅 ADMIN）——薄壳，业务逻辑在 server/services/operation-log.ts
// 支持过滤：entity / action / actorId / entityId / ip / status / keyword / 时间范围
// 返回：基础字段 + 审计字段（userAgent / requestId / method / path / status / errorMessage）
//     + actor 名字 / 是否系统用户 + entityLabel / entityHref / entityDisplay
import { z } from "zod";
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { listOperationLogs } from "@/server/services/operation-log";

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  entity: z.string().optional(),
  action: z.string().optional(),
  actorId: z.string().optional(),
  entityId: z.string().optional(),
  ip: z.string().optional(),
  status: z.enum(["SUCCESS", "FAILURE"]).optional(),
  // 模糊关键字：对象ID / 请求路径 / 请求ID / 失败原因
  keyword: z.string().trim().min(1).max(100).optional(),
  // 时间范围筛选(对应 `at` 字段)
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const p = query.parse(Object.fromEntries(url.searchParams));
      const { from: fromRaw, to: toRaw, ...rest } = p;
      const from = fromRaw ? new Date(fromRaw) : undefined;
      const to = toRaw ? new Date(toRaw) : undefined;
      const result = await listOperationLogs(user, {
        ...rest,
        ...(from && !Number.isNaN(from.getTime()) ? { from } : {}),
        ...(to && !Number.isNaN(to.getTime()) ? { to } : {}),
      });
      return ok(result);
    } catch (e) {
      return err(e);
    }
  });
}
