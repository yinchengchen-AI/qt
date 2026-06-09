import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { terminateContract } from "@/server/services/contract";

const schema = z.object({ reason: z.string().max(500).optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { reason } = schema.parse(body);
    const data = await terminateContract(user, id, reason);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
