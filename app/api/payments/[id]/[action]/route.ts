import { z } from "zod";
import { ok, err, ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { requireSession } from "@/lib/session";
import { paymentAction } from "@/server/services/payment";
import { paymentActionSchema, type PaymentActionInput } from "@/lib/validators/payment";

const ACTIONS: ReadonlySet<PaymentActionInput["action"]> = new Set([
  "confirm",
  "reconcile",
  "refund",
  "cancel",
  "allocate"
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  try {
    const user = await requireSession();
    const { id, action } = await params;
    if (!ACTIONS.has(action as PaymentActionInput["action"])) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, `未知动作: ${action}`, 404);
    }
    const body = await req.json().catch(() => ({}));
    const parsed = paymentActionSchema.omit({ action: true }).parse(body);
    const data = await paymentAction(user, id, { action: action as PaymentActionInput["action"], ...parsed });
    return ok(data);
  } catch (e) {
    return err(e);
  }
}