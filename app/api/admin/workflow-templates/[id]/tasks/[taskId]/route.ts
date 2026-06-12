import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { updateTask, deleteTask } from "@/server/services/workflow-template";
import { WORKFLOW_RECURRENCE_UNIT } from "@/types/enums";

const patchSchema = z.object({
  code: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(100).optional(),
  sort: z.number().int().min(0).optional(),
  description: z.string().max(2000).nullable().optional(),
  requiredRole: z.string().nullable().optional(),
  requiresDeliverable: z.boolean().optional(),
  requiresOnsite: z.boolean().optional(),
  requiresTwoStepReview: z.boolean().optional(),
  isRecurring: z.boolean().optional(),
  recurrenceUnit: z.enum(WORKFLOW_RECURRENCE_UNIT).nullable().optional(),
  recurrenceInterval: z.number().int().positive().nullable().optional(),
  estimateDays: z.number().int().positive().nullable().optional()
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
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
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  try {
    const user = await requireSession();
    const { taskId } = await params;
    const data = await deleteTask(user, taskId);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
