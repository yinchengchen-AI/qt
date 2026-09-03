import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { clearReadMessages } from "@/server/services/message";
import { isMessageCategory } from "@/lib/message-categories";

const body = z
  .object({
    types: z.array(z.string()).optional(),
    categories: z
      .array(z.string().refine((v) => isMessageCategory(v), "invalid category"))
      .optional(),
    q: z.string().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional()
  })
  .optional();

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const json = (await req.json().catch(() => null)) ?? {};
      const parsed = (body as z.ZodTypeAny).parse(json);
      const data = await clearReadMessages(user, parsed ?? {});
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
