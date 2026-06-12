import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { duplicateTask } from "@/server/services/workflow-template";

const schema = z.object({
  targetStageId: z.string().min(1).optional(),
  newCode: z.string().min(1).max(50).regex(/^[A-Z0-9_]+$/, "code 必须大写字母/数字/下划线").optional(),
  newName: z.string().min(1).max(100).optional()
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  try {
    const user = await requireSession();
    const { taskId } = await params;
    const body = await req.json().catch(() => ({}));
    const input = schema.parse(body);
    const data = await duplicateTask(user, taskId, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
