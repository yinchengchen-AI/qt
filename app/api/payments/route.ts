import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listPayments, createPayment } from "@/server/services/payment";
import { paymentCreateSchema, paymentListQuerySchema } from "@/lib/validators/payment";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = paymentListQuerySchema.parse(Object.fromEntries(url.searchParams));
      const data = await listPayments(user, params);
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
      const input = paymentCreateSchema.parse(body);
      const data = await createPayment(user, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
