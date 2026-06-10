import { z } from "zod";
import { ok, err } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { listAll, createDict } from "@/server/services/dictionary";
import { dictCreateSchema, dictListQuerySchema } from "@/lib/validators/dictionary";

const legacyQuery = z.object({ category: z.string().min(1) });

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    const url = new URL(req.url);
    const sp = Object.fromEntries(url.searchParams);

    // 兼容老用法:?category=xxx (给下拉用,只返回 isActive=true)
    if (sp.category && !sp.page && !sp.includeInactive && !sp.keyword) {
      const { category } = legacyQuery.parse(sp);
      requirePermission(user.roleCode, RESOURCE.DICTIONARY, ACTION.READ);
      const data = await prisma.dictionary.findMany({
        where: { category, isActive: true },
        orderBy: { sort: "asc" },
        select: { code: true, label: true }
      });
      return ok(data);
    }

    // 新用法:分页 + includeInactive + keyword
    const params = dictListQuerySchema.parse(sp);
    const data = await listAll(user, params);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireSession();
    const body = await req.json();
    const input = dictCreateSchema.parse(body);
    const data = await createDict(user, input);
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
