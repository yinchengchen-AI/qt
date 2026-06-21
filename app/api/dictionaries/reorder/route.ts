import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { reorder } from "@/server/services/dictionary";
import { dictReorderSchema } from "@/lib/validators/dictionary";

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const body = await req.json();
      const { items } = dictReorderSchema.parse(body);
      const data = await reorder(user, items);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
