import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { toggleStatus } from "@/server/services/user";
import { userToggleStatusSchema } from "@/lib/validators/user";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json();
      const { status } = userToggleStatusSchema.parse(body);
      const data = await toggleStatus(user, id, status);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
