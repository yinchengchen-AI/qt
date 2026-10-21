// 标记一条公告为当前用户已读;幂等;公告详情页 mount 时静默上报。
// 任何登录用户都能调用(只需 ANNOUNCEMENT READ),可见性校验在 service 内做。
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { markAnnouncementRead } from "@/server/services/announcement";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await markAnnouncementRead(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
