import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { taskAction } from "@/server/services/workflow";
import { workflowTaskActionSchema } from "@/lib/validators/workflow";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json();
    const input = workflowTaskActionSchema.parse(body);
    const data = await taskAction(user, id, input.action, {
      remark: input.remark,
      attachments: input.attachments ?? undefined
    });
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
