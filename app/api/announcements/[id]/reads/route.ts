// 已读名单 + 阅读统计: 仅发布人本人或 ADMIN/OPS 可查 (service 内做归属校验)。
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listAnnouncementReads } from "@/server/services/announcement";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await listAnnouncementReads(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
