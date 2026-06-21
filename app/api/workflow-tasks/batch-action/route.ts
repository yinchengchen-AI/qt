import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { batchTaskAction } from "@/server/services/workflow";
import { WORKFLOW_TASK_ACTIONS } from "@/types/enums";

const BATCH_ACTIONS = [...WORKFLOW_TASK_ACTIONS, "assign"] as const;

const schema = z.object({
  taskIds: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(BATCH_ACTIONS),
  assigneeId: z.string().min(1).nullable().optional(),
  remark: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const body = await req.json();
      const input = schema.parse(body);
      const data = await batchTaskAction(user, input.taskIds, input.action, {
        assigneeId: input.assigneeId ?? undefined,
        remark: input.remark,
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
