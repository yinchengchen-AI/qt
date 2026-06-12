import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { assignTask } from "@/server/services/workflow";
import { workflowTaskAssignSchema } from "@/lib/validators/workflow";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json();
    const input = workflowTaskAssignSchema.parse(body);
    const data = await assignTask(user, id, input.assigneeId);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
