// 工作流任务实例状态变更流 — 聚合项目下所有 WorkflowTaskInstance 的状态机迁移
// 与 getProjectHistory 的区别: 严格只展示 task 状态变化 (start/complete/block/
// unblock/skip), 不含项目级 (WORKFLOW_INSTANTIATE / WORKFLOW_RECURRING_*),
// 不含 assign / remark / 附件 / 校核. 给项目详情右栏的"任务历史"卡专用.
//
// 设计: docs/superpowers/specs/2026-06-22-minimal-pm-workflow-design.md §4.1
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { ownerViaContract } from "@/lib/ownership";

// 只显示 5 个动作产生的状态迁移
const STATUS_CHANGE_ACTIONS = new Set([
  "WORKFLOW_TASK_START",
  "WORKFLOW_TASK_COMPLETE",
  "WORKFLOW_TASK_BLOCK",
  "WORKFLOW_TASK_UNBLOCK",
  "WORKFLOW_TASK_SKIP",
]);

export type TaskHistoryItem = {
  id: string;
  instanceId: string;
  taskName: string;
  taskCode: string;
  action: string; // WORKFLOW_TASK_START 等
  fromStatus: string | null;
  toStatus: string;
  actorId: string;
  actorName: string | null;
  at: string;
};

export type TaskHistoryDto = {
  items: TaskHistoryItem[];
};

export async function getProjectTaskHistory(
  user: SessionUser,
  projectId: string,
): Promise<TaskHistoryDto> {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      ...(ownerViaContract(user) as Prisma.ProjectWhereInput),
    },
    select: { id: true },
  });
  if (!project) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);

  // 一次拉实例 (id + task.name/code) 用于反查
  const instances = await prisma.workflowTaskInstance.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true, task: { select: { name: true, code: true } } },
  });
  if (instances.length === 0) return { items: [] };
  const instanceMap = new Map(
    instances.map((x) => [x.id, { name: x.task.name, code: x.task.code }]),
  );
  const instanceIds = instances.map((x) => x.id);

  const logs = await prisma.operationLog.findMany({
    where: {
      entity: "WorkflowTaskInstance",
      entityId: { in: instanceIds },
      action: { in: Array.from(STATUS_CHANGE_ACTIONS) },
    },
    orderBy: { at: "desc" },
    take: 200,
  });

  const actorIds = Array.from(new Set(logs.map((l) => l.actorId)));
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true },
  });
  const actorMap = new Map(actors.map((a) => [a.id, a.name]));

  return {
    items: logs
      .map((l) => {
        const meta = instanceMap.get(l.entityId);
        const diff = l.diff as { before?: { status?: string }; after?: { status?: string } } | null;
        return {
          id: l.id,
          instanceId: l.entityId,
          taskName: meta?.name ?? "(未知任务)",
          taskCode: meta?.code ?? "",
          action: l.action,
          fromStatus: diff?.before?.status ?? null,
          toStatus: diff?.after?.status ?? "UNKNOWN",
          actorId: l.actorId,
          actorName: actorMap.get(l.actorId) ?? null,
          at: l.at.toISOString(),
        };
      })
      // 过滤: toStatus 必须解析得到 (脏数据兜底)
      .filter((it) => it.toStatus !== "UNKNOWN"),
  };
}
