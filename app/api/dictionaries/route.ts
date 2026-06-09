import { z } from "zod";
import { ok, err } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";

const query = z.object({ category: z.string().min(1) });

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    requirePermission(user.roleCode, RESOURCE.DICTIONARY, ACTION.READ);
    const url = new URL(req.url);
    const { category } = query.parse(Object.fromEntries(url.searchParams));
    const data = await prisma.dictionary.findMany({
      where: { category, isActive: true },
      orderBy: { sort: "asc" },
      select: { code: true, label: true }
    });
    return ok(data);
  } catch (e) {
    return err(e);
  }
}
