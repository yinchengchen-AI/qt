import type { AnalysisReport } from "@/lib/types/business-report";
import type { BusinessReportData } from "@/server/services/business-report-data";
import type { AgingResult } from "@/server/services/statistics";

export const overviewFixture = {
  contractAmount: 1000,
  invoiceAmount: 800,
  paymentAmount: 500,
  unpaidAmount: 300,
  invoiceRate: 80,
  paymentRate: 62.5,
  contractCount: 2,
  invoiceCount: 3,
  paymentCount: 2
};

export const reportRange = {
  from: new Date("2026-10-01T00:00:00.000Z"),
  to: new Date("2026-10-31T23:59:59.999Z")
};

export const agingResultFixture: AgingResult = {
  buckets: { "0-30": 100, "31-60": 50, "61-90": 20, "90+": 10 },
  total: 4,
  rows: [],
  summary: {
    totalReceivable: 180,
    over90Amount: 10,
    over90Ratio: 5.56,
    largestInvoice: { invoiceId: "i-private", invoiceNo: "PRIVATE-001", remaining: 10 },
    customerCount: 2,
    ownerCount: 1,
    dataQualityExcludedAmount: 20,
    dataQualityExcludedInvoiceCount: 1
  },
  byCustomer: [],
  byOwner: [],
  pagination: { page: 1, pageSize: 1, total: 4, totalPages: 4 },
  basisUsed: "due",
  dataQualityExcluded: {
    amount: 20,
    invoiceCount: 1,
    byCode: { INVALID_AGING_DATE: { amount: 20, invoiceCount: 1 } }
  }
};

export const seriesFixture = [
  { month: "2026-10", contractAmount: 1000, invoiceAmount: 800, paymentAmount: 500 }
];

export const businessReportDataFixture: BusinessReportData = {
  range: reportRange,
  overview: overviewFixture,
  aging: {
    buckets: agingResultFixture.buckets,
    totalReceivable: 180,
    over90Amount: 10,
    over90Ratio: 5.56,
    dataQualityExcludedAmount: 20,
    dataQualityExcludedInvoiceCount: 1
  },
  series: seriesFixture
};

export const reportOptions = { userId: "u1", cacheScope: "u1:SALES" };

export const localReportFixture: AnalysisReport = {
  summary: "规则经营摘要",
  keyFindings: ["规则发现"],
  recommendations: ["规则建议"],
  generatedAt: "2026-11-01T00:00:00.000Z",
  source: "LOCAL",
  model: null,
  cached: false,
  notice: null
};
