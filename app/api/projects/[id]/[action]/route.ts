import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { projectAction } from "@/server/services/project";

const schema = z.object({
  remark: z.string().max(500).optional(),
});

const ACTIONS = new Set([
  "start",
  "suspend",
  "resume",
  "deliver",
  "accept",
  "close",
  "cancel",
  "progress",
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id, action } = await params;
      if (!ACTIONS.has(action)) {
        return ok(
          { code: 404, errorCode: "NOT_FOUND", message: "未知动作" },
          { status: 404 },
        );
      }
      const body = await req.json().catch(() => ({}));
      const parsed = schema.parse(body);
      const data = await projectAction(user, id, {
        action: action as
          | "start"
          | "suspend"
          | "resume"
          | "deliver"
          | "accept"
          | "close"
          | "cancel",
        ...parsed,
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
