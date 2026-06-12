import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { reviewTask } from "@/server/services/workflow";
import { workflowTaskReviewSchema } from "@/lib/validators/workflow";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json();
    const input = workflowTaskReviewSchema.parse(body);
    const data = await reviewTask(user, id, input.action, { comment: input.comment });
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
