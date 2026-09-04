// GET /api/admin/messages-archive/users
// v0.24.0: 给 admin 归档页的接收人下拉: 返回 {id, employeeNo, name} 列表
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listUsersForFilter } from "@/server/services/message";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const data = await listUsersForFilter(user);
      return ok({ list: data });
    } catch (e) {
      return err(e);
    }
  });
}
