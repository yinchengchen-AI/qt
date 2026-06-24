import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { updateUserWithProfile } from "@/server/services/user";
import { userWithProfileUpdateSchema } from "@/lib/validators/user";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json();
      const { user: userInput, profile: profileInput, attachmentIds } = userWithProfileUpdateSchema.parse(body);
      const data = await updateUserWithProfile(user, id, userInput ?? {}, profileInput, attachmentIds);
      return ok({ data });
    } catch (e) {
      return err(e);
    }
  });
}
