import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { resetPassword } from "@/server/services/user";
import { userResetPasswordSchema } from "@/lib/validators/user";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json();
    const { password } = userResetPasswordSchema.parse(body);
    await resetPassword(user, id, password);
    return ok({ ok: true });
  } catch (e) {
    return err(e);
  }
}
