import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { addTask } from "@/server/services/workflow-template";
import { ROLE_CODES, WORKFLOW_RECURRENCE_UNIT } from "@/types/enums";

const schema = z.object({
  stageId: z.string().min(1),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  sort: z.number().int().min(0),
  description: z.string().max(2000).nullable().optional(),
  requiredRole: z.enum(ROLE_CODES).nullable().optional(),
  requiresDeliverable: z.boolean().optional(),
  requiresOnsite: z.boolean().optional(),
  requiresTwoStepReview: z.boolean().optional(),
  isRecurring: z.boolean().optional(),
  recurrenceUnit: z.enum(WORKFLOW_RECURRENCE_UNIT).nullable().optional(),
  recurrenceInterval: z.number().int().positive().nullable().optional(),
  estimateDays: z.number().int().positive().nullable().optional()
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json();
    const input = schema.parse(body);
    const data = await addTask(user, id, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
