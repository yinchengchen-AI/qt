import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import {
  getOverview,
  getCustomerDistribution,
  getInvoiceAging,
  getTopCustomers,
} from "@/server/services/statistics";
import { prisma } from "@/lib/prisma";
import { ownerEq, ownerViaContract } from "@/lib/ownership";
import type { Prisma } from "@prisma/client";

// dashboard/summary 接受 from/to,默认本月;前端不传则展示"本月经营快照"
const query = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

function monthRange(): { from: Date; to: Date } {
  const now = new Date();
  return {
    from: new Date(now.getFullYear(), now.getMonth(), 1),
    to: now,
  };
}

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const from = parsed.from ? new Date(parsed.from) : monthRange().from;
      const to = parsed.to ? new Date(parsed.to) : monthRange().to;
      const range = { from, to };
      const own = ownerEq(user);
      const ownVia = ownerViaContract(user);
      const [
        overview,
        distribution,
        aging,
        topCustomers,
        customerCount,
        projectStats,
        contractSCs,
        invoiceSCs,
        paymentSCs,
        newCusts,
        townRows,
      ] = await Promise.all([
        getOverview(user, range),
        getCustomerDistribution(user),
        getInvoiceAging(user),
        getTopCustomers(user, "contract", 5),
        prisma.customer.count({
          where: { deletedAt: null, ...own } as Prisma.CustomerWhereInput,
        }),
        // project 是"当前状态快照",不按时间过滤(IN_PROGRESS / ACCEPTED 这些是当下事实)
        prisma.project.groupBy({
          by: ["status"],
          where: { deletedAt: null, ...ownVia } as Prisma.ProjectWhereInput,
          _count: { _all: true },
        }),
        // 合同按签订日期在范围内(与 overview.contractAmount 同口径)
        prisma.contract.groupBy({
          by: ["status"],
          where: {
            deletedAt: null,
            signDate: { gte: from, lte: to },
            ...own,
          } as Prisma.ContractWhereInput,
          _count: { _all: true },
          _sum: { totalAmount: true },
        }),
        // invoice / payment: SALES 隔离走 contract 关系(否则 SALES 看到全公司)
        // 时间范围按开票日期,与 overview.invoiceAmount 同口径
        prisma.invoice.groupBy({
          by: ["status"],
          where: {
            deletedAt: null,
            actualIssueDate: { gte: from, lte: to },
            ...ownVia,
          } as Prisma.InvoiceWhereInput,
          _count: { _all: true },
          _sum: { amount: true },
        }),
        // 回款按到账日期在范围内,与 overview.paymentAmount 同口径
        prisma.payment.groupBy({
          by: ["status"],
          where: {
            deletedAt: null,
            receivedAt: { gte: from, lte: to },
            ...ownVia,
          } as Prisma.PaymentWhereInput,
          _count: { _all: true },
          _sum: { amount: true },
        }),
        prisma.customer.count({
          where: {
            deletedAt: null,
            createdAt: { gte: from, lte: to },
            ...own,
          } as Prisma.CustomerWhereInput,
        }),
        prisma.customer.findMany({
          where: {
            deletedAt: null,
            town: { not: null },
          } as Prisma.CustomerWhereInput,
          select: { town: true },
        }),
      ]);

      // 区域分布反映"现有客户的地域结构",全期统计;不按 from/to 过滤
      const townMap: Record<string, number> = {};
      for (const r of townRows) {
        const k = r.town || "";
        townMap[k] = (townMap[k] || 0) + 1;
      }
      const townDistribution = Object.entries(townMap)
        .map(([town, count]) => ({ town, count }))
        .sort((a, b) => b.count - a.count);

      return ok({
        overview,
        distribution,
        agingBuckets: aging.buckets,
        customers: { total: customerCount, newThisMonth: newCusts },
        projects: {
          total: projectStats.reduce((s, x) => s + x._count._all, 0),
          byStatus: projectStats.map((x) => ({
            status: x.status,
            count: x._count._all,
          })),
        },
        contracts: {
          byStatus: contractSCs.map((x) => ({
            status: x.status,
            count: x._count._all,
            totalAmount: Number(x._sum.totalAmount ?? 0),
          })),
        },
        invoices: {
          total: invoiceSCs.reduce((s, x) => s + x._count._all, 0),
          byStatus: invoiceSCs.map((x) => ({
            status: x.status,
            count: x._count._all,
            totalAmount: Number(x._sum.amount ?? 0),
          })),
        },
        payments: {
          total: paymentSCs.reduce((s, x) => s + x._count._all, 0),
          byStatus: paymentSCs.map((x) => ({
            status: x.status,
            count: x._count._all,
            totalAmount: Number(x._sum.amount ?? 0),
          })),
        },
        topCustomers,
        townDistribution,
      });
    } catch (e) {
      return err(e);
    }
  });
}
