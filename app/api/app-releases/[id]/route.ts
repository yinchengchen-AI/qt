import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { getRelease } from "@/server/services/app-release";

// 只读详情;编辑/删除已随手工发布功能一并移除(更新日志全自动发布)。
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await getRelease(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
