import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listRoles, createRole } from "@/server/services/role";
import { roleCreateSchema, roleListQuerySchema } from "@/lib/validators/role";

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const params = roleListQuerySchema.parse(Object.fromEntries(url.searchParams));
    const data = await listRoles(user, params);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireSession();
    const body = await req.json();
    const input = roleCreateSchema.parse(body);
    const data = await createRole(user, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
