// 单员工业绩明细：按签约人维度返回该员工的合同明细 + 汇总指标
// 用途：员工业绩页面抽屉查看个人合同明细（默认只看自己作为签约人的合同；行级隔离由 service 强制）。
import { z } from "zod";
import { ok, err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { resolveDateRangeQuery } from "@/lib/date-range";
import { getSignerContractDetail } from "@/server/services/statistics";

const query = z.object({
  userId: z.string().min(1, "userId 不能为空"),
  from: z.string().optional(),
  to: z.string().optional()
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.STATISTICS, ACTION.READ);
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const range = resolveDateRangeQuery(parsed);

      // 拉全量分组后过滤目标签约人;单租户数据量小,N+1 过滤可接受。
      // SALES 角色: service 已强制 ownerUserId/signerId 至少匹配自己,这里再按 userId 过滤一次也无害。
      const groups = await getSignerContractDetail(user, range);
      const group = groups.find((g) => g.signerId === parsed.userId) ?? null;

      if (!group) {
        return ok({
          signer: null,
          rows: [],
          totals: { contractCount: 0, contractAmount: 0, subtotalWan: 0 }
        });
      }

      return ok({
        signer: {
          id: group.signerId,
          name: group.signerName,
          employeeNo: group.signerEmployeeNo
        },
        rows: group.rows.map((r) => ({
          contractId: r.contractId,
          contractNo: r.contractNo,
          region: r.region,
          customerId: r.customerId,
          customerName: r.customerName,
          serviceType: r.serviceType,
          serviceTypeLabel: r.serviceTypeLabel,
          signDate: r.signDate,
          totalAmount: r.totalAmount
        })),
        totals: {
          contractCount: group.rows.length,
          contractAmount: group.contractAmount,
          subtotalWan: group.subtotalWan
        }
      });
    } catch (e) {
      return err(e);
    }
  });
}
