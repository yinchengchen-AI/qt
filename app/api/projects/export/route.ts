// 项目列表导出 XLSX
import { z } from "zod";
import { runWithRequestContext } from "@/lib/request-context";
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { listProjects } from "@/server/services/project";
import { exportToXlsx, exportMaxRows } from "@/lib/excel";
import { prisma } from "@/lib/prisma";
import { PROJECT_STATUS_MAP } from "@/lib/enum-maps";

const query = z.object({
  keyword: z.string().optional(),
  status: z.string().optional(),
  contractId: z.string().optional(),
});

export async function GET(req: Request) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.EXPORT);
      const url = new URL(req.url);
      const params = query.parse(Object.fromEntries(url.searchParams));
      const { list } = await listProjects(user, {
        page: 1,
        pageSize: exportMaxRows(),
        ...params,
      });
      // 批量把负责人 id 解析成姓名(employeeNo), 避免导出 N+1
      const managerIds = [
        ...new Set(
          list
            .map((p) => (p as { managerUserId?: string | null }).managerUserId)
            .filter((v): v is string => Boolean(v)),
        ),
      ];
      const managers = managerIds.length
        ? await prisma.user.findMany({
            where: { id: { in: managerIds } },
            select: { id: true, name: true, employeeNo: true },
          })
        : [];
      const managerById = new Map(managers.map((u) => [u.id, u]));
      const ts = new Date().toISOString().slice(0, 10);
      const buf = await exportToXlsx(
        list as unknown as Record<string, unknown>[],
        [
          { header: "项目编号", key: "projectNo", width: 22 },
          { header: "项目名称", key: "name", width: 28 },
          {
            header: "所属合同",
            key: "contractNo",
            width: 22,
            formatter: (_v, r) =>
              (r as { contract?: { contractNo?: string } }).contract
                ?.contractNo ?? "",
          },
          {
            header: "合同标题",
            key: "contractTitle",
            width: 28,
            formatter: (_v, r) =>
              (r as { contract?: { title?: string } }).contract?.title ?? "",
          },
          {
            header: "项目负责人",
            key: "managerUserId",
            width: 16,
            formatter: (_v, r) => {
              const id = (r as { managerUserId?: string | null }).managerUserId;
              if (!id) return "";
              const u = managerById.get(id);
              return u ? `${u.name}(${u.employeeNo})` : "";
            },
          },
          {
            header: "起期",
            key: "startDate",
            width: 14,
            formatter: (v) =>
              v ? new Date(v as string).toLocaleDateString("zh-CN") : "",
          },
          {
            header: "止期",
            key: "endDate",
            width: 14,
            formatter: (v) =>
              v ? new Date(v as string).toLocaleDateString("zh-CN") : "",
          },
          {
            header: "状态",
            key: "status",
            width: 10,
            formatter: (v) =>
              v ? (PROJECT_STATUS_MAP[v as string] ?? (v as string)) : "",
          },
        ],
      );
      return new Response(new Uint8Array(buf), {
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="projects-${ts}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return err(e);
    }
  });
}
