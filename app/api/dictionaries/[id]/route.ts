import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getDict, updateDict, softDisableDict } from "@/server/services/dictionary";
import { dictUpdateSchema } from "@/lib/validators/dictionary";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await getDict(user, id);
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
    const input = dictUpdateSchema.parse(body);
    const data = await updateDict(user, id, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await softDisableDict(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
