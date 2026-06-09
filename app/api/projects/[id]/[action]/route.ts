import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { projectAction } from "@/server/services/project";

const schema = z.object({
  percent: z.number().int().min(0).max(100).optional(),
  remark: z.string().max(500).optional()
});

const ACTIONS = new Set(["start", "suspend", "resume", "deliver", "accept", "close", "cancel", "progress"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  try {
    const user = await requireSession();
    const { id, action } = await params;
    if (!ACTIONS.has(action)) {
      return ok({ code: 404, errorCode: "NOT_FOUND", message: "未知动作" }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const parsed = schema.parse(body);
    const data = await projectAction(user, id, { action: action as any, ...parsed });
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
