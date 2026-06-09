import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { invoiceAction } from "@/server/services/invoice";

const schema = z.object({
  reason: z.string().max(500).optional(),
  invoiceNo: z.string().max(50).optional(),
  actualIssueDate: z.iso.datetime().optional()
});

const ACTIONS = new Set(["submit", "issue", "reject", "void", "red-flush"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  try {
    const user = await requireSession();
    const { id, action } = await params;
    if (!ACTIONS.has(action)) {
      return ok({ code: 404, message: "未知动作" }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const parsed = schema.parse(body);
    const data = await invoiceAction(user, id, { action: action as any, ...parsed });
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
