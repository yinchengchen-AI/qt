import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listCustomers, createCustomer } from "@/server/services/customer";
import { customerCreateSchema, customerListQuerySchema } from "@/lib/validators/customer";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = customerListQuerySchema.parse(Object.fromEntries(url.searchParams));
      const data = await listCustomers(user, params);
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
      const input = customerCreateSchema.parse(body);
      const data = await createCustomer(user, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
