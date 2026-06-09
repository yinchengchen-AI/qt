import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { addFollowUp, listFollowUps } from "@/server/services/customer";
import { followUpCreateSchema } from "@/lib/validators/customer";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await listFollowUps(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json();
    const input = followUpCreateSchema.parse(body);
    const data = await addFollowUp(user, id, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
