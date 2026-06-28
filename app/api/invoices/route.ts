import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listInvoices, createInvoice } from "@/server/services/invoice";
import { invoiceCreateSchema, invoiceListQuerySchema } from "@/lib/validators/invoice";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = invoiceListQuerySchema.parse(Object.fromEntries(url.searchParams));
      const data = await listInvoices(user, params);
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
      const body = await req.json();
      const input = invoiceCreateSchema.parse(body);
      const data = await createInvoice(user, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
