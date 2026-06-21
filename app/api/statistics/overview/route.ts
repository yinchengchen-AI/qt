import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { ok, err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import {
  getOverview,
  getTimeSeries,
  getCustomerDistribution,
} from "@/server/services/statistics";
import { prisma } from "@/lib/prisma";
import { ownerEq } from "@/lib/ownership";
import type { Prisma } from "@prisma/client";

const query = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      const url = new URL(req.url);
      const parsed = query.parse(Object.fromEntries(url.searchParams));
      const from = parsed.from ? new Date(parsed.from) : undefined;
      const to = parsed.to ? new Date(parsed.to) : undefined;
      const range = { from, to };
      const own = ownerEq(user);

      const [
        overview,
        series,
        distribution,
        customerCount,
        newCustomers,
        projectStats,
      ] = await Promise.all([
        getOverview(user, range),
        getTimeSeries(user, range),
        getCustomerDistribution(user),
        prisma.customer.count({
          where: { deletedAt: null, ...own } as Prisma.CustomerWhereInput,
        }),
        prisma.customer.count({
          where: {
            deletedAt: null,
            ...own,
            createdAt: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          } as Prisma.CustomerWhereInput,
        }),
        prisma.project.groupBy({
          by: ["status"],
          where: { deletedAt: null, ...own } as Prisma.ProjectWhereInput,
          _count: { _all: true },
        }),
      ]);

      const townRows = await prisma.customer.findMany({
        where: {
          deletedAt: null,
          town: { not: null },
        } as Prisma.CustomerWhereInput,
        select: { town: true },
      });
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
        series,
        distribution,
        customers: { total: customerCount, newThisMonth: newCustomers },
        projects: {
          total: projectStats.reduce((s, x) => s + x._count._all, 0),
          byStatus: projectStats.map((x) => ({
            status: x.status,
            count: x._count._all,
          })),
        },
        townDistribution,
      });
    } catch (e) {
      return err(e);
    }
  });
}
