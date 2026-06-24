import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listContracts, createContract } from "@/server/services/contract";
import { contractCreateSchema, contractListQuerySchema } from "@/lib/validators/contract";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = contractListQuerySchema.parse(Object.fromEntries(url.searchParams));
      const data = await listContracts(user, params);
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
      const input = contractCreateSchema.parse(body);
      const data = await createContract(user, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
