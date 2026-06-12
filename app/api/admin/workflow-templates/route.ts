import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listTemplates } from "@/server/services/workflow-template";

export async function GET(_req: Request) {
  try {
    const user = await requireSession();
    const data = await listTemplates(user);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
