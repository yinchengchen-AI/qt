import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
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
  requiredRole: z.enum(ROLE_CODES).nullable().optional(), });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
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
  });
}
