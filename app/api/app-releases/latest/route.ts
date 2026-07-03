// /api/app-releases/latest
// 给 DashboardShell popup 用:返回当前用户尚未已读的最新一条 release,
// 以及累计发布数/已读数,UI 可拼"还有 N 条更新未读" 之类提示。
// 该接口允许任意登录用户访问(RESOURCE.APP_RELEASE READ);不存在未读时返回 release=null。
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getLatestUnreadRelease } from "@/server/services/app-release";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const data = await getLatestUnreadRelease(user);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
