import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { migrateTaskInstances } from "@/server/services/workflow-template";

const schema = z.object({ fromTaskId: z.string().min(1), toTaskId: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const user = await requireSession();
    const body = await req.json();
    const input = schema.parse(body);
    const data = await migrateTaskInstances(user, input.fromTaskId, input.toTaskId);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
