import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import {
  getOverview, getCustomerDistribution, getInvoiceAging,
  getTopCustomers
} from "@/server/services/statistics";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

function ownFilter(user: { roleCode: string; id: string }) {
  return user.roleCode === "SALES" ? { ownerUserId: user.id } : {};
}

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const range = {};
    const own = ownFilter(user);
    const [
      overview, distribution, aging, topCustomers,
      customerCount, projectStats, contractSCs, invoiceSCs, paymentSCs, newCusts,
      townRows
    ] = await Promise.all([
      getOverview(user, range),
      getCustomerDistribution(user),
      getInvoiceAging(user),
      getTopCustomers(user, "contract", 5),
      prisma.customer.count({ where: { deletedAt: null, ...own } as Prisma.CustomerWhereInput }),
      prisma.project.groupBy({
        by: ["status"], where: { deletedAt: null, ...own } as Prisma.ProjectWhereInput,
        _count: { _all: true }
      }),
      prisma.contract.groupBy({
        by: ["status"], where: { deletedAt: null, ...own } as Prisma.ContractWhereInput,
        _count: { _all: true }, _sum: { totalAmount: true }
      }),
      prisma.invoice.groupBy({
        by: ["status"], where: { deletedAt: null },
        _count: { _all: true }, _sum: { amount: true }
      }),
      prisma.payment.groupBy({
        by: ["status"], where: { deletedAt: null },
        _count: { _all: true }, _sum: { amount: true }
      }),
      prisma.customer.count({
        where: { deletedAt: null, createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }, ...own } as Prisma.CustomerWhereInput
      }),
      prisma.customer.findMany({
        where: { deletedAt: null, town: { not: null } } as Prisma.CustomerWhereInput,
        select: { town: true }
      })
    ]);

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
      projects: { total: projectStats.reduce((s, x) => s + x._count._all, 0), byStatus: projectStats.map(x => ({ status: x.status, count: x._count._all })) },
      contracts: { byStatus: contractSCs.map(x => ({ status: x.status, count: x._count._all, totalAmount: Number(x._sum.totalAmount ?? 0) })) },
      invoices: { total: invoiceSCs.reduce((s, x) => s + x._count._all, 0), byStatus: invoiceSCs.map(x => ({ status: x.status, count: x._count._all, totalAmount: Number(x._sum.amount ?? 0) })) },
      payments: { total: paymentSCs.reduce((s, x) => s + x._count._all, 0), byStatus: paymentSCs.map(x => ({ status: x.status, count: x._count._all, totalAmount: Number(x._sum.amount ?? 0) })) },
      topCustomers,
      townDistribution
    });
  } catch (e) {
    return err(e);
  }
}
