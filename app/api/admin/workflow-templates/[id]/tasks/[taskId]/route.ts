import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { updateTask, deleteTask } from "@/server/services/workflow-template";
import { ROLE_CODES, WORKFLOW_RECURRENCE_UNIT } from "@/types/enums";

const patchSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100).optional(),
  sort: z.number().int().min(0).optional(),
  description: z.string().max(2000).nullable().optional(),
  requiredRole: z.enum(ROLE_CODES).nullable().optional(), });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { taskId } = await params;
      const body = await req.json();
      const input = patchSchema.parse(body);
      const data = await updateTask(user, taskId, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; taskId: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { taskId } = await params;
      const data = await deleteTask(user, taskId);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
