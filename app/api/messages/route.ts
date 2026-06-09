import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listMessages } from "@/server/services/message";

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unread: z.coerce.boolean().optional()
});

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const params = query.parse(Object.fromEntries(url.searchParams));
    const data = await listMessages(user, params);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
