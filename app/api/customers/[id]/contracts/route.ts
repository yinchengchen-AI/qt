import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listCustomerContracts } from "@/server/services/customer";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await listCustomerContracts(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
