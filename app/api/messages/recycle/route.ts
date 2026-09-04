// GET /api/messages/recycle
// v0.24.0 用户侧回收站: 列出当前用户 receiverUserId = self 的软删消息 (deletedAt != null)
import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listRecycleBin } from "@/server/services/message";
import { isMessageCategory } from "@/lib/message-categories";

const query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  types: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined)),
  categories: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter((s) => isMessageCategory(s))
        : undefined
    ),
  q: z.string().min(1).max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = query.parse(Object.fromEntries(url.searchParams));
      const data = await listRecycleBin(user, {
        page: params.page,
        pageSize: params.pageSize,
        types: params.types,
        categories: params.categories as never,
        q: params.q ?? null,
        from: params.from ?? null,
        to: params.to ?? null
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
