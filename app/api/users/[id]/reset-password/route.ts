import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { resetPassword } from "@/server/services/user";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await resetPassword(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
