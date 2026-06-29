import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { reopenContract, type ContractReopenReason } from "@/server/services/contract";

const schema = z.object({
  reason: z.enum([
    "recovered_from_fake_close",
    "data_correction",
    "reopen_for_payment",
    "other",
  ]),
  // reason=other 时必填; 其它 reason 时可选, 会被拼到 audit log 的 comment 里
  reasonNote: z.string().max(500).optional(),
});

/**
 * Admin 重新打开已完结合同: CLOSED → ACTIVE
 *
 * 用法: 用于 cron 误关恢复、admin 误操作回滚、closed 合同补录回款
 * body: {
 *   reason: "recovered_from_fake_close" | "data_correction" | "reopen_for_payment" | "other",
 *   reasonNote?: string  // reason=other 时必填
 * }
 *
 * 权限: 仅 ADMIN
 * 前置: contract.status 必须为 CLOSED
 * 副作用: 写 ContractReviewLog (action=MANUAL_REOPEN) + audit log
 *
 * ⚠️ 注意: 重开后如果仍满足 tryAutoCloseOnOverdue 条件,
 *   下次 cron 跑会再次强关. 应当重开后立即补录回款.
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
      const { reason, reasonNote } = schema.parse(body);
      const data = await reopenContract(user, id, reason as ContractReopenReason, reasonNote);
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}