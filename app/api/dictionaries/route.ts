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
      // ?tree=true: 返回树形 (仅 REGION 等有 parentCode 的字典)
      if (sp.tree === "true") {
        const flat = await prisma.dictionary.findMany({
          where: { category, isActive: true },
          orderBy: [{ sort: "asc" }, { code: "asc" }],
          select: { id: true, code: true, label: true, parentCode: true, sort: true, isActive: true }
        });
        return ok(buildDictTree(flat));
      }
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

/**
 * 把扁平字典 (有 parentCode 字段) 拼成 antd TreeData 格式
 *   顶级: { code, label, children: [...] }
 *   子级递归
 *   parentCode 引用不存在的 code 会被忽略 (作为顶级)
 */
type DictTreeNode = { id: string; code: string; label: string; parentCode: string | null; isActive: boolean; children: DictTreeNode[] };
function buildDictTree(
  flat: { id: string; code: string; label: string; parentCode: string | null; sort: number; isActive: boolean }[]
): DictTreeNode[] {
  type Node = DictTreeNode & { _raw: typeof flat[number] };
  const map = new Map<string, Node>();
  for (const f of flat) {
    map.set(f.code, { id: f.id, code: f.code, label: f.label, parentCode: f.parentCode, isActive: f.isActive, children: [], _raw: f });
  }
  const roots: Node[] = [];
  for (const f of flat) {
    const node = map.get(f.code)!;
    if (f.parentCode && map.has(f.parentCode)) {
      map.get(f.parentCode)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // UI 只要 code/label/children (去除内部 _raw)
  return roots.map(({ id, code, label, parentCode, isActive, children }) => ({ id, code, label, parentCode, isActive, children }));
}
