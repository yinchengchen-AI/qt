import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { instantiateProjectWorkflow } from "@/server/services/workflow";

const schema = z.object({ force: z.boolean().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const { force } = schema.parse(body);
    const data = await instantiateProjectWorkflow(user, id, { force: !!force });
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
