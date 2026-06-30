// 催收记录: 更新 + 删除
//   PATCH  /api/statistics/aging/dunning-notes/:id
//   DELETE /api/statistics/aging/dunning-notes/:id
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { updateDunningNote, deleteDunningNote, dunningNoteUpdateSchema } from "@/server/services/dunning";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await ctx.params;
      const body = await req.json();
      const patch = dunningNoteUpdateSchema.parse(body);
      const data = await updateDunningNote(user, id, patch);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}

export async function DELETE(req: Request, ctx: Ctx) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await ctx.params;
      await deleteDunningNote(user, id);
      return ok({ id });
    } catch (e) {
      return err(e);
    }
  });
}
