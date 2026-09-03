import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { batchMutate } from "@/server/services/message";

const body = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(200),
  action: z.enum(["markRead", "delete"])
});

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const json = await req.json().catch(() => ({}));
      const input = body.parse(json);
      const data = await batchMutate(user, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
