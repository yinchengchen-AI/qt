// 项目列表导出 XLSX
import { z } from "zod";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { listProjects } from "@/server/services/project";
import { exportToXlsx } from "@/lib/excel";

const query = z.object({
  keyword: z.string().optional(),
  status: z.string().optional(),
  contractId: z.string().optional()
});

export async function GET(req: Request) {
  try {
    const user = await requireSession();
    requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.EXPORT);
    const url = new URL(req.url);
    const params = query.parse(Object.fromEntries(url.searchParams));
    const { list } = await listProjects(user, { page: 1, pageSize: 10000, ...params });
    const ts = new Date().toISOString().slice(0, 10);
    const buf = await exportToXlsx(
      list as unknown as Record<string, unknown>[],
      [
        { header: "项目编号", key: "projectNo", width: 22 },
        { header: "项目名称", key: "name", width: 28 },
        { header: "所属合同", key: "contractNo", width: 22, formatter: (_v, r) => (r as { contract?: { contractNo?: string } }).contract?.contractNo ?? "" },
        { header: "合同标题", key: "contractTitle", width: 28, formatter: (_v, r) => (r as { contract?: { title?: string } }).contract?.title ?? "" },
        { header: "起期", key: "startDate", width: 14, formatter: (v) => v ? new Date(v as string).toLocaleDateString("zh-CN") : "" },
        { header: "止期", key: "endDate", width: 14, formatter: (v) => v ? new Date(v as string).toLocaleDateString("zh-CN") : "" },
        { header: "预算", key: "budgetAmount", width: 16, formatter: (v) => v != null && v !== "" ? Number(v).toFixed(2) : "" },
        { header: "状态", key: "status", width: 10 }
      ],
      `项目列表_${ts}.xlsx`
    );
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=projects_${ts}.xlsx`
      }
    });
  } catch (e) {
    return err(e);
  }
}
