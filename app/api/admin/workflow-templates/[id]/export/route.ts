import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { exportTemplate } from "@/server/services/workflow-template";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await exportTemplate(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
