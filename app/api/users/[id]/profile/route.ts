import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { getUserFullProfile } from "@/server/services/employee-profile";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      // PR3:走 getUserFullProfile 拿全部数据(包含 5 张子表 + 头像),
      // 但只返回 profile 部分保持旧 API 兼容
      const full = await getUserFullProfile(actor, id);
      return ok({ data: full?.profile ?? null });
    } catch (e) {
      return err(e);
    }
  });
}
