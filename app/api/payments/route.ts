import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listPayments, createPayment } from "@/server/services/payment";
import { paymentCreateSchema } from "@/lib/validators/payment";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  status: z.string().optional(),
  contractId: z.string().optional(),
  invoiceId: z.string().optional()
});

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const params = listQuery.parse(Object.fromEntries(url.searchParams));
    const data = await listPayments(user, params);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireSession();
    const body = await req.json();
    const input = paymentCreateSchema.parse(body);
    const data = await createPayment(user, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
