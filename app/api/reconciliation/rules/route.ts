import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { listRules, createRule } from "@/server/services/reconciliation";
import { reconciliationRuleSchema } from "@/lib/validators/reconciliation";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const data = await listRules(user);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const raw = await req.json();
      const input = reconciliationRuleSchema.parse(raw);
      const data = await createRule(user, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
