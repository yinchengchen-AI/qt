import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getWorkflowOverview } from "@/server/services/workflow";

export async function GET(_req: Request) {
  try {
    const user = await requireSession();
    const data = await getWorkflowOverview(user);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
