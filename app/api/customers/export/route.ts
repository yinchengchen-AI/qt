// 客户列表导出 XLSX
// - 入参同 GET /api/customers(keyword/status),便于从列表页带当前筛选条件拉全量
// - 行级隔离:仍调 listCustomers,SALES 用户只会导出自己负责的客户
// - 上限 10000 行,够用
import { z } from "zod";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { listCustomers } from "@/server/services/customer";
import { exportToXlsx } from "@/lib/excel";
import { prisma } from "@/lib/prisma";
import { ALLOWED_DICTIONARY_CATEGORIES } from "@/lib/dictionary-categories";
import { CUSTOMER_STATUS_MAP } from "@/lib/enum-maps";

// 把动态字典(category+code -> label)和客户状态静态 map 拍平成一个查找表
async function loadDict(): Promise<Record<string, string>> {
  const items = await prisma.dictionary.findMany({
    where: { category: { in: [...ALLOWED_DICTIONARY_CATEGORIES] }, isActive: true },
    select: { category: true, code: true, label: true }
  });
  const out: Record<string, string> = { ...CUSTOMER_STATUS_MAP };
  for (const i of items) out[`${i.category}::${i.code}`] = i.label;
  return out;
}

const query = z.object({
  keyword: z.string().optional(),
  // status / scale 接受单值或逗号分隔多值
  status: z.string().optional(),
  scale: z.string().optional(),
});

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.EXPORT);
    const url = new URL(req.url);
    const params = query.parse(Object.fromEntries(url.searchParams));
    // pageSize=10000 当作"全量"上限
    const { list } = await listCustomers(user, { page: 1, pageSize: 10000, ...params });
    const dict = await loadDict();
    const label = (cat: string, code?: string | null) => code ? (dict[`${cat}::${code}`] ?? code) : "";
    const ts = new Date().toISOString().slice(0, 10);
    const buf = await exportToXlsx(
      list as unknown as Record<string, unknown>[],
      [
        { header: "客户编号", key: "code", width: 18 },
        { header: "客户全称", key: "name", width: 30 },
        { header: "简称", key: "shortName", width: 18 },
        { header: "统一社会信用代码", key: "unifiedSocialCreditCode", width: 22 },
        { header: "类型", key: "customerType", width: 10, formatter: (v) => label("CUSTOMER_TYPE", v as string) },
        { header: "规模", key: "scale", width: 8, formatter: (v) => label("CUSTOMER_SCALE", v as string) },
        { header: "行业", key: "industry", width: 14, formatter: (v) => label("CUSTOMER_INDUSTRY", v as string) },
        { header: "客户来源", key: "sourceChannel", width: 14, formatter: (v) => label("CUSTOMER_SOURCE", v as string) },
        { header: "状态", key: "status", width: 10, formatter: (v) => label("CUSTOMER_STATUS", v as string) },
        { header: "联系人", key: "contactName", width: 18, formatter: (_v, r) => {
          const x = r as { contactName?: string | null; contactTitle?: string | null };
          return [x.contactName, x.contactTitle].filter(Boolean).join(" · ") || "";
        }},
        { header: "联系电话", key: "contactPhone", width: 16 },
        { header: "所在地区", key: "province", width: 24, formatter: (_v, r) => {
          const x = r as { province?: string; city?: string };
          return [x.province, x.city].filter(Boolean).join(" / ");
        }},
        { header: "详细地址", key: "address", width: 30 },
        { header: "创建时间", key: "createdAt", width: 20, formatter: (v) => v ? new Date(v as string).toLocaleString("zh-CN") : "" }
      ],
      `客户列表_${ts}.xlsx`
    );
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=customers_${ts}.xlsx`
      }
    });
  } catch (e) {
    return err(e);
  }
}
