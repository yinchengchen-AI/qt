import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getProjectHistory } from "@/server/services/workflow";

// 项目级工作流活动流:包含项目级动作 + 全部任务实例动作
// 每条都带 instanceId / taskName / taskCode,前端不用再反查
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await getProjectHistory(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
