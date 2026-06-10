import { z } from "zod";
import { ok, err, ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { requireSession } from "@/lib/session";
import { invoiceAction } from "@/server/services/invoice";
import { invoiceActionSchema, type InvoiceActionInput } from "@/lib/validators/invoice";

const ACTIONS: ReadonlySet<InvoiceActionInput["action"]> = new Set([
  "submit",
  "issue",
  "reject",
  "void",
  "red-flush"
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  try {
    const user = await requireSession();
    const { id, action } = await params;
    if (!ACTIONS.has(action as InvoiceActionInput["action"])) {
      throw new ApiError(ERROR_CODES.NOT_FOUND, `未知动作: ${action}`, 404);
    }
    const body = await req.json().catch(() => ({}));
    const parsed = invoiceActionSchema.omit({ action: true }).parse(body);
    const data = await invoiceAction(user, id, { action: action as InvoiceActionInput["action"], ...parsed });
    return ok(data);
  } catch (e) {
    return err(e);
  }
}