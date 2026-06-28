// GET /api/contracts/[id]/publish-eligibility
//
// 返回当前 DRAFT 合同是否满足 DRAFT → ACTIVE 自动发布的前置条件, 以及具体缺什么字段。
// 详情页"检查是否可发布"按钮调这个; 真正发起的 POST /publish 仍然保留, 但前端不再暴露,
// 只用于 support 脚本和应急绕过。
//
// 复用 server/services/contract/status.ts:checkPublishable, 跟 tryAutoPublish 的判定完全一致,
// 不会出现"前端说可发、自动说不发"的不一致。
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err, ApiError } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ownerEq } from "@/lib/ownership";
import { checkPublishable } from "@/server/services/contract";
import { ERROR_CODES } from "@/types/errors";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      const c = await prisma.contract.findFirst({
        where: { id, deletedAt: null, ...ownerEq(user) },
        select: {
          status: true,
          customerId: true,
          contractNo: true,
          title: true,
          serviceType: true,
          signDate: true,
          startDate: true,
          endDate: true,
          totalAmount: true,
          taxRate: true,
          ownerUserId: true,
          signerId: true,
          attachments: true
        }
      });
      if (!c) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
      // 非 DRAFT 状态: 自动发布逻辑不会跑, 这里直接返回 eligible=false 并解释原因
      if (c.status !== "DRAFT") {
        return ok({
          status: c.status,
          eligible: false,
          missing: [`当前状态 ${c.status}, 自动发布仅在 DRAFT 触发`]
        });
      }
      const check = checkPublishable(c);
      return ok({ status: c.status, ...check });
    } catch (e) {
      return err(e);
    }
  });
}
