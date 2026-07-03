// 标记一条 release 为当前用户已读;幂等;popup "已了解" 按钮调用。
// 任何登录用户都能调用(无需 ADMIN),权限校验在 service 内做 RESOURCE.APP_RELEASE.READ。
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { markReleaseRead } from "@/server/services/app-release";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await markReleaseRead(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
