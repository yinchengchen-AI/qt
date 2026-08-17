import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { autoMatchBatch } from "@/server/services/reconciliation";
import { batchMatchSchema } from "@/lib/validators/reconciliation";

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const raw = await req.json();
      const input = batchMatchSchema.parse(raw);
      const data = await autoMatchBatch(user, input.transactionIds);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
