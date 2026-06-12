import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { addStage } from "@/server/services/workflow-template";
import { WORKFLOW_PHASE_ORDER } from "@/types/enums";

const schema = z.object({
  phase: z.enum(WORKFLOW_PHASE_ORDER),
  code: z.string().min(1).max(50).regex(/^[A-Z0-9_]+$/, "code 必须大写字母/数字/下划线"),
  name: z.string().min(1).max(100),
  sort: z.number().int().min(0),
  description: z.string().max(2000).nullable().optional(),
  isRequired: z.boolean().optional()
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json();
    const input = schema.parse(body);
    const data = await addStage(user, id, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
