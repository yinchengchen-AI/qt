// 操作日志过滤元数据（仅 ADMIN）：日志里真实出现过的 entity / action / actor
// 供列表页搜索区动态生成下拉选项，避免前端硬编码候选值
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { getOperationLogMeta } from "@/server/services/operation-log";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      return ok(await getOperationLogMeta(user));
    } catch (e) {
      return err(e);
    }
  });
}
