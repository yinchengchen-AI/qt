import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listMessages } from "@/server/services/message";

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  // ?unread=true|false,字符串值,避免 z.coerce.boolean() 把 "false"/"0" 也当 true
  unread: z.enum(["true", "false"]).optional().transform((v) => v === "true")
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
