import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getInvoice, updateInvoice } from "@/server/services/invoice";
import { invoiceUpdateSchema } from "@/lib/validators/invoice";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const data = await getInvoice(user, id);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    const { id } = await params;
    const body = await req.json();
    const input = invoiceUpdateSchema.parse(body);
    const data = await updateInvoice(user, id, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
