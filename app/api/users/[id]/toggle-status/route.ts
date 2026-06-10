import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { toggleStatus } from "@/server/services/user";
import { userToggleStatusSchema } from "@/lib/validators/user";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
}
