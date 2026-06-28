import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getTrashList, restoreRecord } from "@/server/services/trash";

// GET /api/admin/trash — 列出所有软删除记录
export async function GET() {
  try {
    const user = await requireSession();
    const data = await getTrashList(user);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

const restoreSchema = z.object({
  entityType: z.string().min(1),
  id: z.string().min(1),
});

// POST /api/admin/trash — 恢复指定记录
export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const body = await req.json();
      const input = restoreSchema.parse(body);
      const data = await restoreRecord(user, input.entityType, input.id);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
