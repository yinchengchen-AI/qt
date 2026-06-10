import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getRole, updateRole, deleteRole } from "@/server/services/role";
import { roleUpdateSchema } from "@/lib/validators/role";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await getRole(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json();
    const input = roleUpdateSchema.parse(body);
    const data = await updateRole(user, id, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await deleteRole(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
