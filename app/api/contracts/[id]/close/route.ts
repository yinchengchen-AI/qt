import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { closeContract, type ContractCloseReason } from "@/server/services/contract";

const CLOSE_REASONS = ["completed", "terminated", "expired"] as const;

const schema = z.object({
  reason: z.enum(CLOSE_REASONS)
});

/**
 * admin 强制完结: ACTIVE → CLOSED 兜底入口
 * 自动完结 (tryAutoComplete / tryAutoCloseOnExpiry) 也走内部 closeContract, 这里是 admin 手动入口
 * body: { reason: "completed" | "terminated" | "expired" }
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json().catch(() => ({}));
      const { reason } = schema.parse(body);
      const data = await closeContract(user, id, reason as ContractCloseReason, "MANUAL");
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
