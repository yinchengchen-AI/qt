// 客户列表导出 XLSX
// - 入参同 GET /api/customers(keyword/status/level),便于从列表页带当前筛选条件拉全量
// - 行级隔离:仍调 listCustomers,SALES 用户只会导出自己负责的客户
// - 上限 10000 行,够用
import { z } from "zod";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { listCustomers } from "@/server/services/customer";
import { exportToXlsx } from "@/lib/excel";

const query = z.object({
  keyword: z.string().optional(),
  status: z.string().optional(),
  level: z.string().optional()
});

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    requirePermission(user.roleCode, RESOURCE.CUSTOMER, ACTION.EXPORT);
    const url = new URL(req.url);
    const params = query.parse(Object.fromEntries(url.searchParams));
    // pageSize=10000 当作"全量"上限
    const { list } = await listCustomers(user, { page: 1, pageSize: 10000, ...params });
    const ts = new Date().toISOString().slice(0, 10);
    const buf = await exportToXlsx(
      list as unknown as Record<string, unknown>[],
      [
        { header: "客户编号", key: "code", width: 18 },
        { header: "客户全称", key: "name", width: 30 },
        { header: "简称", key: "shortName", width: 18 },
        { header: "统一社会信用代码", key: "unifiedSocialCreditCode", width: 22 },
        { header: "类型", key: "customerType", width: 10 },
        { header: "等级", key: "level", width: 8 },
        { header: "行业", key: "industry", width: 14 },
        { header: "客户来源", key: "sourceChannel", width: 14 },
        { header: "状态", key: "status", width: 10 },
        { header: "联系电话", key: "contactPhone", width: 16 },
        { header: "邮箱", key: "contactEmail", width: 22 },
        { header: "所在地区", key: "province", width: 24, formatter: (_v, r) => {
          const x = r as { province?: string; city?: string };
          return [x.province, x.city].filter(Boolean).join(" / ");
        }},
        { header: "详细地址", key: "address", width: 30 },
        { header: "账期(天)", key: "paymentTermDays", width: 10 },
        { header: "授信额度", key: "creditLimitAmount", width: 16, formatter: (v) => v != null && v !== "" ? Number(v).toFixed(2) : "" },
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
