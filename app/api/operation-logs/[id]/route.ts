// 单条操作日志详情（含全量 diff / UA / 请求上下文 / 关联实体的可读名）
// 仅 ADMIN——薄壳，业务逻辑在 server/services/operation-log.ts
import { z } from "zod";
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { getOperationLogDetail } from "@/server/services/operation-log";

const paramsSchema = z.object({ id: z.string().min(1) });

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = paramsSchema.parse(await params);
      return ok(await getOperationLogDetail(user, id));
    } catch (e) {
      return err(e);
    }
  });
}
