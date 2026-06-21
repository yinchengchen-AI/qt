import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { reviewTask } from "@/server/services/workflow";
import { workflowTaskReviewSchema } from "@/lib/validators/workflow";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json();
      const input = workflowTaskReviewSchema.parse(body);
      const data = await reviewTask(user, id, input.action, {
        comment: input.comment,
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
