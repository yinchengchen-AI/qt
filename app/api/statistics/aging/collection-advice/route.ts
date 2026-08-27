// 智能催款建议 (Phase 5 接线)
//   规则引擎版, 不依赖 DEEPSEEK_API_KEY; 数据组装见 server/services/collection-advice.ts
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getCollectionAdvice } from "@/server/services/collection-advice";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const data = await getCollectionAdvice(user);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
