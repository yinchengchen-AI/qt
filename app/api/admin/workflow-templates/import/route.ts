import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { importTemplate } from "@/server/services/workflow-template";
import { WORKFLOW_PHASE_ORDER } from "@/types/enums";

const stageTaskSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  sort: z.number().int().min(0),
  description: z.string().max(2000).nullable().optional(),
  requiredRole: z.string().nullable().optional(),
  requiresDeliverable: z.boolean().optional(),
  requiresOnsite: z.boolean().optional(),
  requiresTwoStepReview: z.boolean().optional(),
  isRecurring: z.boolean().optional(),
  recurrenceUnit: z.string().nullable().optional(),
  recurrenceInterval: z.number().int().positive().nullable().optional(),
  estimateDays: z.number().int().positive().nullable().optional()
});

const stageSchema = z.object({
  phase: z.enum(WORKFLOW_PHASE_ORDER),
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  sort: z.number().int().min(0),
  description: z.string().max(2000).nullable().optional(),
  isRequired: z.boolean().optional(),
  tasks: z.array(stageTaskSchema)
});

const bodySchema = z.object({
  data: z.object({
    schemaVersion: z.literal(1),
    serviceType: z.string().min(1).max(50),
    name: z.string().min(1).max(100),
    description: z.string().max(2000).nullable().optional(),
    isActive: z.boolean().optional(),
    stages: z.array(stageSchema).min(1)
  }),
  newActive: z.boolean().optional()
});

export async function POST(req: Request) {
  try {
    const user = await requireSession();
    const body = await req.json();
    const input = bodySchema.parse(body);
    const data = await importTemplate(user, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
