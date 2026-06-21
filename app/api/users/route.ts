import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { listUsers, createUser } from "@/server/services/user";
import { userCreateSchema, userListQuerySchema } from "@/lib/validators/user";

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = userListQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      const data = await listUsers(user, params);
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
      const input = userCreateSchema.parse(body);
      const data = await createUser(user, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
