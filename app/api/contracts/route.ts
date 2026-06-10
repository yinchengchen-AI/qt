import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listContracts, createContract } from "@/server/services/contract";
import { contractCreateSchema } from "@/lib/validators/contract";

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  // 接受单值或逗号分隔多值,如 ?status=EFFECTIVE,EXECUTING
  status: z.string().optional(),
  customerId: z.string().optional()
});

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const params = listQuery.parse(Object.fromEntries(url.searchParams));
    const data = await listContracts(user, params);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireSession();
    const body = await req.json();
    const input = contractCreateSchema.parse(body);
    const data = await createContract(user, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
