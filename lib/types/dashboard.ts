import type { DateRange } from "@/lib/date-range";
import type { AgingBuckets } from "@/lib/types/aging";

type StatusSummary = {
  status: string;
  count: number;
  totalAmount: number;
};

type DashboardOverview<Range> = {
  contractAmount: number;
  invoiceAmount: number;
  paymentAmount: number;
  unpaidAmount: number;
  invoiceRate: number;
  paymentRate: number;
  contractCount: number;
  invoiceCount: number;
  paymentCount: number;
  range: Range;
};

type DashboardSummaryShape<Range> = {
  overview: DashboardOverview<Range>;
  agingBuckets: AgingBuckets;
  customers: { total: number; newInRange: number };
  contracts: { byStatus: StatusSummary[] };
  invoices: { total: number; byStatus: StatusSummary[]; pending: number };
  payments: { total: number; byStatus: StatusSummary[] };
  topCustomers: { id: string; name: string; code: string; total: number; contractCount: number }[];
  townDistribution: { town: string | null; count: number }[];
};

export type DashboardSummary = DashboardSummaryShape<{ from?: string; to?: string }>;
export type DashboardSummaryResult = DashboardSummaryShape<DateRange>;
