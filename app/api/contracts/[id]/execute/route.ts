import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { lifecycleContract } from "@/server/services/contract";
import { lifecycleActionSchema } from "@/lib/validators/contract";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const parsed = lifecycleActionSchema.parse(body);
    const data = await lifecycleContract(user, id, "EXECUTE", parsed.comment);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
