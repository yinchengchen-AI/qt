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
import { parseDateRangeQuery } from "@/lib/date-range";
import { lookup, CUSTOMER_TYPE_MAP, CUSTOMER_SCALE_MAP } from "@/lib/enum-maps";
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
      const range = parseDateRangeQuery(parsed);
      const own = ownerEq(user);

      const [
        overview,
        series,
        distribution,
        customerCount,
        newCustomers,
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
            ...(range.from || range.to
              ? { createdAt: { ...(range.from ? { gte: range.from } : {}), ...(range.to ? { lte: range.to } : {}) } }
              : {})
          } as Prisma.CustomerWhereInput,
        }),
      ]);

      const townRows = await prisma.customer.findMany({
        where: {
          deletedAt: null,
          town: { not: null },
          ...own,
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

      // 把分布的原始枚举 key(code)翻译成中文 label;null 表示未填写
      const labelDistribution = {
        byScale: distribution.byScale.map((x) => ({ key: x.key, label: lookup(CUSTOMER_SCALE_MAP, x.key) || "未填写", count: x.count })),
        byType: distribution.byType.map((x) => ({ key: x.key, label: lookup(CUSTOMER_TYPE_MAP, x.key) || "未填写", count: x.count })),

      };

      return ok({
        overview,
        series,
        distribution: labelDistribution,
        customers: { total: customerCount, newInRange: newCustomers },
        townDistribution,
      });
    } catch (e) {
      return err(e);
    }
  });
}
