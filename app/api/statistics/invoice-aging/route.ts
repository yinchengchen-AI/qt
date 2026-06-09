import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getInvoiceAging } from "@/server/services/statistics";

export async function GET() {
  try {
    const user = await requireSession();
    const data = await getInvoiceAging(user);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
