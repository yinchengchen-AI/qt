import { z } from "zod";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { getMyTasks } from "@/server/services/workflow";
import { WORKFLOW_TASK_STATUS } from "@/types/enums";

const querySchema = z.object({
  statuses: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter((x) => WORKFLOW_TASK_STATUS.includes(x as never)) : undefined)),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const params = querySchema.parse(Object.fromEntries(url.searchParams));
    const data = await getMyTasks(user, { statuses: params.statuses as never, limit: params.limit });
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
