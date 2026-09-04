// POST /api/admin/messages-archive/batch
// v0.24.0: 管理员批量恢复/硬删
//   body: { ids: string[], mode: "archive" | "recycle", action: "restore" | "purge" }
import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import {
  restoreArchivedToInbox,
  adminRestoreRecycled,
  adminPurgeRecycled
} from "@/server/services/message";

const body = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(200),
  mode: z.enum(["archive", "recycle"]),
  action: z.enum(["restore", "purge"])
});

export async function POST(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const json = await req.json().catch(() => ({}));
      const input = body.parse(json);
      if (input.mode === "archive" && input.action === "restore") {
        // 逐条 restoreArchivedToInbox, 避免大批量时 transaction 过大
        const results: { id: string; newId: string }[] = [];
        for (const id of input.ids) {
          const r = await restoreArchivedToInbox(user, id);
          results.push({ id, newId: r.newId });
        }
        return ok({ affected: results.length, results });
      }
      if (input.mode === "recycle" && input.action === "restore") {
        const data = await adminRestoreRecycled(user, input.ids);
        return ok(data);
      }
      if (input.mode === "recycle" && input.action === "purge") {
        const data = await adminPurgeRecycled(user, input.ids);
        return ok(data);
      }
      // archive + purge 暂不支持 (归档表是 append-only 审计, 不应清空)
      throw new Error("不支持的操作组合");
    } catch (e) {
      return err(e);
    }
  });
}
