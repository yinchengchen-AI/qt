import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { getUserFullProfile, updateUserFullProfile } from "@/server/services/employee-profile";
import { userWithProfileUpdateSchema } from "@/lib/validators/user";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      const data = await getUserFullProfile(actor, id);
      return ok({ data });
    } catch (e) {
      return err(e);
    }
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const actor = await requireSession();
      const { id } = await params;
      const body = await req.json();
      const input = userWithProfileUpdateSchema.parse(body);
      const data = await updateUserFullProfile(actor, id, input);
      return ok({ data });
    } catch (e) {
      return err(e);
    }
  });
}
