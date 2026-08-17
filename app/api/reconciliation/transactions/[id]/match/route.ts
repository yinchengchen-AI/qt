import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import {
  autoMatchTransaction,
  confirmMatch,
  manualMatch,
  unmatchTransaction,
  ignoreTransaction,
} from "@/server/services/reconciliation";
import { matchActionSchema } from "@/lib/validators/reconciliation";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const raw = await req.json();
      const input = matchActionSchema.parse(raw);

      let data;
      switch (input.action) {
        case "auto-match":
          data = await autoMatchTransaction(user, id);
          break;
        case "confirm-match":
          if (!input.paymentId) throw new Error("paymentId is required");
          data = await confirmMatch(user, id, input.paymentId);
          break;
        case "manual-match":
          if (!input.paymentId) throw new Error("paymentId is required");
          data = await manualMatch(user, id, input.paymentId);
          break;
        case "unmatch":
          data = await unmatchTransaction(user, id);
          break;
        case "ignore":
          data = await ignoreTransaction(user, id);
          break;
        default:
          throw new Error(`Unknown action: ${input.action}`);
      }
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
