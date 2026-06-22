// GET /api/projects/[id]/task-history
// 项目下所有 WorkflowTaskInstance 状态机变更流 (start/complete/block/unblock/skip).
// 替换原 /api/projects/[id]/history (PR-1 期间 410 Gone, PR-2 文件删除).
//
// 设计: docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md §4.1
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { getProjectTaskHistory } from "@/server/services/workflow-task-history";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await getProjectTaskHistory(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
