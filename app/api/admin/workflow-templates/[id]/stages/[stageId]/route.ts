import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { updateStage, deleteStage } from "@/server/services/workflow-template";

const patchSchema = z.object({
  code: z.string().min(1).max(50).regex(/^[A-Z0-9_]+$/).optional(),
  name: z.string().min(1).max(100).optional(),
  sort: z.number().int().min(0).optional(),
  description: z.string().max(2000).nullable().optional(),
  isRequired: z.boolean().optional()
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; stageId: string }> }) {
  try {
    const user = await requireSession();
    const { stageId } = await params;
    const body = await req.json();
    const input = patchSchema.parse(body);
    const data = await updateStage(user, stageId, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; stageId: string }> }) {
  try {
    const user = await requireSession();
    const { stageId } = await params;
    const data = await deleteStage(user, stageId);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
