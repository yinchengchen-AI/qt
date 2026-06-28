// POST /api/customers/[id]/revert
// 客户状态机自动化 (§2.4): owner 在 7 天异议窗口内撤销系统自动写的客户状态.
// 权限: CUSTOMER:UPDATE (SALES 仅能撤销自己负责的客户, ADMIN 全权).
// 行为: 走 runTransitionInTx 用 rule.revertTarget (per-rule 配置) 作为合法状态机迁移目标;
//   失败抛 ApiError 由 err() 包成 4xx.
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { revertCustomerStatus } from "@/server/services/customer/status";
import { customerRevertSchema } from "@/lib/validators/customer";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const body = await req.json();
      const input = customerRevertSchema.parse(body);
      const result = await revertCustomerStatus(user, {
        customerId: id,
        reason: input.reason
      });
      return ok(result);
    } catch (e) {
      return err(e);
    }
  });
}
