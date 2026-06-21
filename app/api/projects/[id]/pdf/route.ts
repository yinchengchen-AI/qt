// 项目详情 → 打印页 HTML
import { err } from "@/lib/api";
import { runWithRequestContext } from "@/lib/request-context";
import { requireSession } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { getProject, getProjectOverview } from "@/server/services/project";
import { getProjectHistory } from "@/server/services/workflow";
// 复用 service 里的 JSON 解析,避免 PDF 端双写一份
// (workflow.ts 的 readAttachments 把 [{id,name,mimeType,size,...}] / {items:[...]} 两种 shape 都吃)
import { readAttachments as readTaskAttachments } from "@/server/services/workflow";
import { prisma } from "@/lib/prisma";
import {
  renderPrintHtml,
  type PrintDoc,
  type PrintTableSection,
} from "@/lib/print-html";
import { PROJECT_STATUS_MAP, WORKFLOW_ACTION_MAP } from "@/lib/enum-maps";

const fmtDate = (s: string | Date | null | undefined) =>
  s ? new Date(s).toLocaleDateString("zh-CN") : "—";
const fmtDateTime = (s: string | Date | null | undefined) =>
  s ? new Date(s).toLocaleString("zh-CN") : "—";
const fmtAmount = (v: string | number | null | undefined) =>
  v == null || v === "" ? "—" : "¥" + Number(v).toFixed(2);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return runWithRequestContext(req, async () => {
    try {
      const user = await requireSession();
      requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.EXPORT);
      const { id } = await params;
      const p = await getProject(user, id);
      const overview = await getProjectOverview(user, id);
      const history = await getProjectHistory(user, id);
      const [manager, progressLogs, taskInstances] = await Promise.all([
        p.managerUserId
          ? prisma.user.findUnique({
              where: { id: p.managerUserId },
              select: { name: true, employeeNo: true },
            })
          : Promise.resolve(null),
        prisma.projectProgressLog.findMany({
          where: { projectId: id },
          orderBy: { at: "desc" },
          take: 20,
        }),
        // 项目级附件 = 所有任务实例 attachments JSON 的并集(去重)
        prisma.workflowTaskInstance.findMany({
          where: { projectId: id, deletedAt: null },
          select: {
            attachments: true,
            task: { select: { name: true, code: true } },
          },
        }),
      ]);

      // 把 task instance 的 attachments 拍平去重:
      // - 同一附件被多个任务引用时,合并其所在任务名(逗号分隔)
      // - size/mimeType 从已有 JSON 取;uploadedAt 取最早一次(任务级时间)
      const ATTACH_BY_ID = new Map<
        string,
        {
          id: string;
          name: string;
          mimeType: string;
          size: number;
          tasks: string[];
          uploadedAt?: string;
        }
      >();
      for (const ins of taskInstances) {
        const taskLabel = ins.task
          ? `${ins.task.name}${ins.task.code ? "(" + ins.task.code + ")" : ""}`
          : "(未关联任务)";
        for (const a of readTaskAttachments(ins.attachments)) {
          const cur = ATTACH_BY_ID.get(a.id);
          if (cur) {
            if (!cur.tasks.includes(taskLabel)) cur.tasks.push(taskLabel);
          } else {
            ATTACH_BY_ID.set(a.id, {
              id: a.id,
              name: a.name,
              mimeType: a.mimeType,
              size: a.size,
              tasks: [taskLabel],
              uploadedAt: a.uploadedAt,
            });
          }
        }
      }
      const projectAttachments = Array.from(ATTACH_BY_ID.values()).sort(
        (a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""),
      );

      const stats = overview.workflowStats;
      const progressPct = (p as { progressPct?: number }).progressPct ?? 0;

      // 阶段完成度表
      const phaseSection: PrintTableSection = {
        title: "工作流阶段完成度",
        columns: ["阶段", "任务数", "已完成", "完成率", "状态"],
        rows: stats.byPhase.map((ph) => {
          const pct =
            ph.total > 0
              ? ((ph.completed / ph.total) * 100).toFixed(1) + "%"
              : "—";
          return {
            阶段: ph.name,
            任务数: String(ph.total),
            已完成: String(ph.completed),
            完成率: pct,
            状态: ph.locked
              ? "锁定(前置未完)"
              : ph.total > 0 && ph.completed === ph.total
                ? "已完成"
                : "进行中",
          };
        }),
      };

      // 活动历史(取最近 30 条,避免撑破)
      const historySection: PrintTableSection = {
        title: "活动历史",
        columns: ["时间", "动作", "任务", "操作人"],
        rows: history.items.slice(0, 30).map((h) => ({
          时间: fmtDateTime(h.at),
          动作: WORKFLOW_ACTION_MAP[h.action] ?? h.action,
          任务: h.taskName
            ? `${h.taskName}${h.taskCode ? "(" + h.taskCode + ")" : ""}`
            : "项目级",
          操作人: h.actorName ?? h.actorId,
        })),
        emptyText: "暂无活动记录",
      };

      const doc: PrintDoc = {
        title: `项目 - ${p.projectNo}`,
        subtitle: `${p.name} · 所属合同 ${p.contract?.contractNo ?? p.contractId ?? "—"}`,
        meta: [
          { label: "项目编号:", value: p.projectNo },
          {
            label: "项目负责人:",
            value: manager ? `${manager.name}(${manager.employeeNo})` : "—",
          },
          {
            label: "项目状态:",
            value: PROJECT_STATUS_MAP[p.status] ?? p.status,
          },
        ],
        mainRows: [
          { label: "项目名称", value: p.name },
          {
            label: "所属合同",
            value: p.contract?.contractNo ?? p.contractId ?? "—",
          },
          {
            label: "项目负责人",
            value: manager ? `${manager.name}(${manager.employeeNo})` : "—",
          },
          {
            label: "项目状态",
            value: PROJECT_STATUS_MAP[p.status] ?? p.status,
          },
          { label: "起期", value: fmtDate(p.startDate) },
          { label: "止期", value: fmtDate(p.endDate) },
          { label: "预算", value: fmtAmount(Number(p.budgetAmount)) },
          {
            label: "项目进度",
            value: `${progressPct.toFixed(1)}%(基于工作流任务完成度)`,
          },
          { label: "创建时间", value: fmtDateTime(p.createdAt) },
        ],
        summary: [
          {
            label: "任务总数",
            value: String(stats.totalTasks),
            tone: "primary",
          },
          { label: "已完成", value: String(stats.completed), tone: "success" },
          { label: "进行中", value: String(stats.inProgress), tone: "warning" },
          { label: "待处理", value: String(stats.pending) },
          { label: "阻塞", value: String(stats.blocked), tone: "danger" },
        ],
        note: p.serviceScope ?? undefined,
        sections: [
          phaseSection,
          {
            title: "项目附件清单",
            columns: ["文件名", "所属任务", "大小", "上传时间"],
            rows: projectAttachments.map((a) => ({
              文件名: a.name,
              所属任务: a.tasks.join("、") || "—",
              大小: a.size > 0 ? (a.size / 1024).toFixed(1) : "—",
              上传时间: a.uploadedAt ? fmtDateTime(a.uploadedAt) : "—",
            })),
            emptyText: "暂无项目附件",
          },
          {
            title: "里程碑日志",
            rows: progressLogs.length
              ? progressLogs.map((l) => ({
                  label: fmtDateTime(l.at),
                  value: l.remark ?? "",
                }))
              : [],
            emptyText: "暂无里程碑记录",
          },
          historySection,
        ],
      };
      return new Response(renderPrintHtml(doc), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (e) {
      return err(e);
    }
  });
}
