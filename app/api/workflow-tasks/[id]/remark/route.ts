import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { updateTaskRemark } from "@/server/services/workflow";
import { workflowTaskUpdateRemarkSchema } from "@/lib/validators/workflow";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json();
      const input = workflowTaskUpdateRemarkSchema.parse(body);
      const data = await updateTaskRemark(user, id, {
        remark: input.remark,
        attachments: input.attachments,
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
