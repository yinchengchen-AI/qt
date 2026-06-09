import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { paymentAction } from "@/server/services/payment";

const schema = z.object({
  bankRefNo: z.string().max(50).optional(),
  reason: z.string().max(500).optional(),
  allocations: z.array(z.object({
    invoiceId: z.string().optional(),
    projectId: z.string().optional(),
    amount: z.number()
  })).optional()
});

const ACTIONS = new Set(["confirm", "reconcile", "refund", "cancel", "allocate"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  try {
    const user = await requireSession();
    const { id, action } = await params;
    if (!ACTIONS.has(action)) {
      return ok({ code: 404, message: "未知动作" }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const parsed = schema.parse(body);
    const data = await paymentAction(user, id, { action: action as any, ...parsed });
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
