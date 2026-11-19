import type { Prisma } from "@prisma/client";
import type { DateRange } from "@/lib/date-range";
import { ownerEq, ownerViaContract } from "@/lib/ownership";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import type { DashboardSummaryResult } from "@/lib/types/dashboard";
import {
  getInvoiceAgingBuckets,
  getOverview,
  getTopCustomers
} from "@/server/services/statistics";

export async function getDashboardSummary(
  user: SessionUser,
  range: DateRange
): Promise<DashboardSummaryResult> {
  const { from, to } = range;
  const own = ownerEq(user);
  const ownVia = ownerViaContract(user);
  const [
    overview,
    agingBuckets,
    topCustomers,
    customerCount,
    contractSCs,
    invoiceSCs,
    paymentSCs,
    newCusts,
    townRows,
    pendingInvoiceCount
  ] = await Promise.all([
    getOverview(user, range),
    getInvoiceAgingBuckets(user),
    getTopCustomers(user, "contract", 5, range),
    prisma.customer.count({
      where: { deletedAt: null, ...own } as Prisma.CustomerWhereInput
    }),
    prisma.contract.groupBy({
      by: ["status"],
      where: {
        deletedAt: null,
        signDate: { gte: from, lte: to },
        ...own
      } as Prisma.ContractWhereInput,
      _count: { _all: true },
      _sum: { totalAmount: true }
    }),
    prisma.invoice.groupBy({
      by: ["status"],
      where: {
        deletedAt: null,
        actualIssueDate: { gte: from, lte: to },
        ...ownVia
      } as Prisma.InvoiceWhereInput,
      _count: { _all: true },
      _sum: { amount: true }
    }),
    prisma.payment.groupBy({
      by: ["status"],
      where: {
        deletedAt: null,
        receivedAt: { gte: from, lte: to },
        ...ownVia
      } as Prisma.PaymentWhereInput,
      _count: { _all: true },
      _sum: { amount: true }
    }),
    prisma.customer.count({
      where: {
        deletedAt: null,
        createdAt: { gte: from, lte: to },
        ...own
      } as Prisma.CustomerWhereInput
    }),
    prisma.customer.groupBy({
      by: ["town"],
      where: { deletedAt: null, town: { not: null }, ...own },
      _count: { _all: true }
    }),
    prisma.invoice.count({
      where: {
        deletedAt: null,
        status: "PENDING_FINANCE",
        ...ownVia
      } as Prisma.InvoiceWhereInput
    })
  ]);

  const townDistribution = townRows
    .map((row) => ({ town: row.town, count: row._count._all }))
    .sort((a, b) => b.count - a.count);

  return {
    overview: { ...overview, range },
    agingBuckets,
    customers: { total: customerCount, newInRange: newCusts },
    contracts: {
      byStatus: contractSCs.map((x) => ({
        status: x.status,
        count: x._count._all,
        totalAmount: Number(x._sum.totalAmount ?? 0)
      }))
    },
    invoices: {
      total: invoiceSCs.reduce((s, x) => s + x._count._all, 0),
      byStatus: invoiceSCs.map((x) => ({
        status: x.status,
        count: x._count._all,
        totalAmount: Number(x._sum.amount ?? 0)
      })),
      pending: pendingInvoiceCount
    },
    payments: {
      total: paymentSCs.reduce((s, x) => s + x._count._all, 0),
      byStatus: paymentSCs.map((x) => ({
        status: x.status,
        count: x._count._all,
        totalAmount: Number(x._sum.amount ?? 0)
      }))
    },
    topCustomers,
    townDistribution
  };
}
