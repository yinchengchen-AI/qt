import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { resolveDiscrepancy } from "@/server/services/reconciliation";
import { resolveDiscrepancySchema } from "@/lib/validators/reconciliation";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const raw = await req.json();
      const input = resolveDiscrepancySchema.parse(raw);
      await resolveDiscrepancy(user, id, input.resolution);
      return ok({ success: true });
    } catch (e) {
      return err(e);
    }
  });
}
