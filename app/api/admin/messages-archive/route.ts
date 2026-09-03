import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listArchivedMessages } from "@/server/services/message";

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  receiverUserId: z.string().min(1).max(64).optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  types: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined)),
  q: z.string().min(1).max(100).optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = query.parse(Object.fromEntries(url.searchParams));
      const data = await listArchivedMessages(user, params);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
