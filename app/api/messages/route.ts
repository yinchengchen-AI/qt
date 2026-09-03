import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listMessages } from "@/server/services/message";
import { isMessageCategory } from "@/lib/message-categories";

const query = z.object({
  // 兼容老客户端: page/pageSize
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  // 新: cursor 分页
  cursor: z.string().min(1).max(200).optional(),
  // ?unread=true|false; 保留 undefined = 不过滤(全部),不能折叠成 false
  unread: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === "true" ? true : v === "false" ? false : undefined)),
  // ?types=A,B,C
  types: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined)),
  // ?categories=contract,finance
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
  // ?q=keyword
  q: z.string().min(1).max(100).optional(),
  // ?from=2026-01-01&to=2026-12-31 (ISO 8601)
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const params = query.parse(Object.fromEntries(url.searchParams));
      const data = await listMessages(user, {
        page: params.page,
        pageSize: params.pageSize,
        cursor: params.cursor ?? null,
        unread: params.unread,
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
