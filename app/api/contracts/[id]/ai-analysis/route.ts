import { ok, err, ApiError } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { getContractRisk } from "@/server/services/contract/workbench";
import { analyzeContractRisk } from "@/server/services/contract-ai";
import type { RiskReport } from "@/server/services/contract/risk-report";
import { ERROR_CODES } from "@/types/errors";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const { id } = await params;
      // getContractRisk 复用合同读权限 (读放开 + contract:read), 内含实时算分与报告契约
      const detail = await getContractRisk(user, id);
      if (!detail) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
      const report: RiskReport = {
        contractId: detail.contractId,
        contractNo: detail.contractNo,
        riskScore: detail.score,
        riskLevel: detail.level,
        asOf: detail.asOf,
        dimensions: detail.dimensions,
        weightedScore: detail.weightedScore,
        recommendations: detail.recommendations,
        trendSummary: detail.trendSummary
      };
      const data = await analyzeContractRisk(report, {
        customerName: detail.customerName,
        title: detail.title,
        totalAmount: detail.totalAmount,
        paidAmount: detail.paidAmount,
        invoicedAmount: detail.invoicedAmount,
        daysOverdue: detail.daysOverdue
      });
      return ok(data);
    } catch (e) {
      return err(e);
    }
  });
}
