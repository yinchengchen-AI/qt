import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { getUser, updateUser, softDeleteUser } from "@/server/services/user";
import { userUpdateSchema } from "@/lib/validators/user";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await getUser(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json();
      const input = userUpdateSchema.parse(body);
      const data = await updateUser(user, id, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const data = await softDeleteUser(user, id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
