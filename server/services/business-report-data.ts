import type { DateRange } from "@/lib/date-range";
import type { SessionUser } from "@/lib/session";
import {
  getInvoiceAging,
  getOverview,
  getTimeSeries,
  type AgingResult
} from "@/server/services/statistics";

export type BusinessReportData = {
  range: DateRange;
  overview: Awaited<ReturnType<typeof getOverview>>;
  aging: {
    buckets: AgingResult["buckets"];
    totalReceivable: number;
    over90Amount: number;
    over90Ratio: number;
    dataQualityExcludedAmount: number;
    dataQualityExcludedInvoiceCount: number;
  };
  series?: Awaited<ReturnType<typeof getTimeSeries>>;
};

export async function collectBusinessReportData(
  user: SessionUser,
  range: DateRange
): Promise<BusinessReportData> {
  const [overview, aging, series] = await Promise.all([
    getOverview(user, range),
    getInvoiceAging(user, { basis: "due", page: 1, pageSize: 1, sort: "daysOverdue:desc" }),
    getTimeSeries(user, range)
  ]);

  return {
    range,
    overview,
    aging: {
      buckets: aging.buckets,
      totalReceivable: aging.summary.totalReceivable,
      over90Amount: aging.summary.over90Amount,
      over90Ratio: aging.summary.over90Ratio,
      dataQualityExcludedAmount: aging.summary.dataQualityExcludedAmount,
      dataQualityExcludedInvoiceCount: aging.summary.dataQualityExcludedInvoiceCount
    },
    series
  };
}
