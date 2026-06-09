import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listCustomers, createCustomer } from "@/server/services/customer";
import { customerCreateSchema } from "@/lib/validators/customer";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  status: z.string().optional(),
  level: z.string().optional()
});

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const params = listQuery.parse(Object.fromEntries(url.searchParams));
    const data = await listCustomers(user, params);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireSession();
    const body = await req.json();
    const input = customerCreateSchema.parse(body);
    const data = await createCustomer(user, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
