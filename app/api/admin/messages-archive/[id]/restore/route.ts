// POST /api/admin/messages-archive/[id]/restore
// v0.24.0: 管理员从归档/回收站恢复一条
//   body: { mode: "archive" | "recycle" }
import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import {
  restoreArchivedToInbox,
  adminRestoreRecycled
} from "@/server/services/message";

const body = z.object({
  mode: z.enum(["archive", "recycle"])
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const json = await req.json().catch(() => ({}));
      const input = body.parse(json);
      if (input.mode === "archive") {
        const data = await restoreArchivedToInbox(user, id);
        return ok(data);
      }
      const data = await adminRestoreRecycled(user, [id]);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
