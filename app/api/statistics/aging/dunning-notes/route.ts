// 催收记录: 列表 + 创建
//   GET  /api/statistics/aging/dunning-notes?invoiceId=xxx
//   POST /api/statistics/aging/dunning-notes
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { listDunningNotes, createDunningNote, dunningNoteCreateSchema } from "@/server/services/dunning";
import { z } from "zod";

const query = z.object({
  invoiceId: z.string().optional(),
  limit: z.string().optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const data = await listDunningNotes(user, {
        invoiceId: parsed.invoiceId,
        limit: parsed.limit ? Number(parsed.limit) : undefined
      });
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
      const input = dunningNoteCreateSchema.parse(body);
      const data = await createDunningNote(user, input);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
