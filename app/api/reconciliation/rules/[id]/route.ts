import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { updateRule, deleteRule } from "@/server/services/reconciliation";
import { reconciliationRuleUpdateSchema } from "@/lib/validators/reconciliation";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const raw = await req.json();
      const input = reconciliationRuleUpdateSchema.parse(raw);
      const data = await updateRule(user, id, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      await deleteRule(user, id);
      return ok({ success: true });
    } catch (e) {
      return err(e);
    }
  });
}
