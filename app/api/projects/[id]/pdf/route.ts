// 项目详情 → 打印页 HTML
import { err } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { getProject } from "@/server/services/project";
import { prisma } from "@/lib/prisma";
import { renderPrintHtml, type PrintDoc } from "@/lib/print-html";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSession();
    requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.EXPORT);
    const { id } = await params;
    const p = await getProject(user, id);
    const [manager, progressLogs] = await Promise.all([
      p.managerUserId ? prisma.user.findUnique({ where: { id: p.managerUserId }, select: { name: true, employeeNo: true } }) : null,
      prisma.projectProgressLog.findMany({ where: { projectId: id }, orderBy: { at: "desc" }, take: 20 })
    ]);

    const doc: PrintDoc = {
      title: `项目 - ${p.projectNo}`,
      subtitle: `${p.name} · 所属合同 ${p.contract?.contractNo ?? p.contractId ?? "—"}`,
      mainRows: [
        { label: "项目编号", value: p.projectNo },
        { label: "项目名称", value: p.name },
        { label: "所属合同", value: p.contract?.contractNo ?? p.contractId ?? "—" },
        { label: "起期", value: p.startDate ? new Date(p.startDate).toLocaleString("zh-CN") : "—" },
        { label: "止期", value: p.endDate ? new Date(p.endDate).toLocaleString("zh-CN") : "—" },
        { label: "预算", value: p.budgetAmount ? Number(p.budgetAmount).toFixed(2) : "—" },
        { label: "项目负责人", value: manager ? `${manager.name} (${manager.employeeNo})` : "—" },
        { label: "状态", value: p.status },
        { label: "服务范围", value: p.serviceScope ?? "—" }
      ],
      sections: [
        {
          title: "进度日志",
          rows: progressLogs.length
            ? progressLogs.map((l) => ({ label: new Date(l.at).toLocaleString("zh-CN"), value: `${l.percent}% · ${l.remark}` }))
            : [{ label: "(无)", value: "" }]
        }
      ]
    };
    return new Response(renderPrintHtml(doc), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (e) {
    return err(e);
  }
}
