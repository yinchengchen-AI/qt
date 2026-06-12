// 工作流引擎 — 业务服务层(P1)
// P0 已落 4 张表 + 9 份激活模板 seed;P1 接管运行时:
// - instantiateProjectWorkflow  按合同 serviceType 克隆模板 → 任务实例
// - getProjectWorkflow          读项目全量实例(按阶段+任务组装返回给前端)
// - taskAction                  实例状态机(PENDING→IN_PROGRESS→COMPLETED 等)
// - reviewTask                  报告类二审(submit 校核 → approve/reject 审核)
// - assignTask / updateTaskRemark  局部字段更新
// - generateRecurringInstances  循环任务的下一个实例(占位,P2 接 cron)
//
// 行级隔离:SALES 看不到非自己合同挂的项目;FINANCE/OPS/ADMIN 看全量。
// 权限:读 = RESOURCE.PROJECT.READ,改 = RESOURCE.PROJECT.UPDATE。

import { Prisma } from "@prisma/client";
import type { PrismaClient, WorkflowTaskInstance } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { ownerViaContract } from "@/lib/ownership";
import { audit } from "@/server/audit";
import { emit } from "@/server/events/bus";
import type {
  WorkflowTaskAction,
  WorkflowTaskStatus,
  WorkflowReviewStatus
} from "@/types/enums";

// =====================================================
// 状态机:合法迁移表
// =====================================================
const TASK_TRANSITIONS: Record<WorkflowTaskAction, { from: WorkflowTaskStatus[]; to: WorkflowTaskStatus }> = {
  start:    { from: ["PENDING", "BLOCKED"], to: "IN_PROGRESS" },
  complete: { from: ["IN_PROGRESS"],        to: "COMPLETED" },
  block:    { from: ["PENDING", "IN_PROGRESS"], to: "BLOCKED" },
  unblock:  { from: ["BLOCKED"],            to: "PENDING" },
  skip:     { from: ["PENDING", "BLOCKED"], to: "SKIPPED" }
};

// 二审:report 任务的 reviewStatus 状态机
// submit   PENDING/IN_PROGRESS → REVIEWING
// approve  REVIEWING            → APPROVED  (任务置 COMPLETED)
// reject   REVIEWING            → REJECTED   (任务回到 IN_PROGRESS 待重交)
const REVIEW_TRANSITIONS: Record<
  "submit" | "approve" | "reject",
  { from: (WorkflowReviewStatus | null)[]; to: WorkflowReviewStatus | null }
> = {
  submit:  { from: [null, "REJECTED"], to: "REVIEWING" },
  approve: { from: ["REVIEWING"],     to: "APPROVED" },
  reject:  { from: ["REVIEWING"],     to: "REJECTED" }
};

// =====================================================
// 实例化模板 → 项目
// =====================================================
export async function instantiateProjectWorkflow(
  user: SessionUser,
  projectId: string,
  opts: { force?: boolean } = {}
) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);

  return prisma.$transaction(async (tx) => {
    const project = await tx.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
        ...(ownerViaContract(user) as Prisma.ProjectWhereInput)
      },
      include: { contract: { select: { serviceType: true, contractNo: true } } }
    });
    if (!project) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);
    if (!project.contract?.serviceType) {
      throw new ApiError(ERROR_CODES.WORKFLOW_TEMPLATE_NOT_FOUND, "合同缺少服务类型,无法初始化工作流", 404);
    }

    const existing = await tx.workflowTaskInstance.count({ where: { projectId, deletedAt: null } });
    if (existing > 0 && !opts.force) {
      throw new ApiError(ERROR_CODES.WORKFLOW_ALREADY_INSTANTIATED, "已存在工作流实例,需要 force=true 才能重置", 409);
    }
    if (existing > 0 && opts.force) {
      // 强制重置:硬删旧实例(模板调整后用,不要在线上误开)
      await tx.workflowTaskInstance.deleteMany({ where: { projectId } });
    }

    const template = await tx.workflowTemplate.findFirst({
      where: { serviceType: project.contract.serviceType, isActive: true, deletedAt: null },
      include: {
        stages: {
          orderBy: { sort: "asc" },
          include: { tasks: { orderBy: { sort: "asc" } } }
        }
      }
    });
    if (!template) {
      throw new ApiError(
        ERROR_CODES.WORKFLOW_TEMPLATE_NOT_FOUND,
        `服务类型 ${project.contract.serviceType} 未配置激活模板,请到 admin 后台维护`,
        404
      );
    }

    const created: WorkflowTaskInstance[] = [];
    for (const stage of template.stages) {
      for (const t of stage.tasks) {
        const ins = await tx.workflowTaskInstance.create({
          data: {
            projectId,
            taskId: t.id,
            status: "PENDING",
            assigneeId: null,
            parentInstanceId: null,
            reviewStatus: null,
            remark: null,
            attachments: Prisma.JsonNull
          }
        });
        created.push(ins);
      }
    }

    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_INSTANTIATE",
      entity: "Project",
      entityId: projectId,
      after: { templateId: template.id, serviceType: project.contract.serviceType, count: created.length, force: !!opts.force }
    });

    return { templateId: template.id, serviceType: project.contract.serviceType, created: created.length };
  });
}

// =====================================================
// 读:项目全量任务实例(按阶段+任务组装)
// =====================================================
export type ProjectWorkflowDto = {
  templateId: string | null;
  templateName: string | null;
  serviceType: string | null;
  stages: Array<{
    phase: string;
    code: string;
    name: string;
    sort: number;
    description: string | null;
    tasks: Array<{
      id: string;
      code: string;
      name: string;
      description: string | null;
      sort: number;
      requiredRole: string | null;
      requiresDeliverable: boolean;
      requiresOnsite: boolean;
      requiresTwoStepReview: boolean;
      isRecurring: boolean;
      recurrenceUnit: string | null;
      recurrenceInterval: number | null;
      estimateDays: number | null;
      status: WorkflowTaskStatus;
      assigneeId: string | null;
      reviewStatus: WorkflowReviewStatus | null;
      reviewedById: string | null;
      reviewedAt: string | null;
      completedAt: string | null;
      completedById: string | null;
      remark: string | null;
      attachments: unknown;
      parentInstanceId: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  }>;
  totals: { total: number; pending: number; inProgress: number; completed: number; skipped: number; blocked: number };
};

export async function getProjectWorkflow(user: SessionUser, projectId: string): Promise<ProjectWorkflowDto> {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);

  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      ...(ownerViaContract(user) as Prisma.ProjectWhereInput)
    },
    include: { contract: { select: { serviceType: true } } }
  });
  if (!project) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);

  const instances = await prisma.workflowTaskInstance.findMany({
    where: { projectId, deletedAt: null },
    orderBy: [{ createdAt: "asc" }],
    include: { task: { include: { stage: true } } }
  });

  if (instances.length === 0) {
    return {
      templateId: null,
      templateName: null,
      serviceType: project.contract?.serviceType ?? null,
      stages: [],
      totals: { total: 0, pending: 0, inProgress: 0, completed: 0, skipped: 0, blocked: 0 }
    };
  }

  // 找到对应模板(同一 serviceType + isActive)
  const template = project.contract?.serviceType
    ? await prisma.workflowTemplate.findFirst({
        where: { serviceType: project.contract.serviceType, isActive: true, deletedAt: null }
      })
    : null;

  // 按阶段聚合
  const stageMap = new Map<string, ProjectWorkflowDto["stages"][number]>();
  const totals = { total: 0, pending: 0, inProgress: 0, completed: 0, skipped: 0, blocked: 0 };
  for (const ins of instances) {
    const stage = ins.task.stage;
    if (!stageMap.has(stage.id)) {
      stageMap.set(stage.id, {
        phase: stage.phase,
        code: stage.code,
        name: stage.name,
        sort: stage.sort,
        description: stage.description,
        tasks: []
      });
    }
    stageMap.get(stage.id)!.tasks.push({
      id: ins.id,
      code: ins.task.code,
      name: ins.task.name,
      description: ins.task.description,
      sort: ins.task.sort,
      requiredRole: ins.task.requiredRole,
      requiresDeliverable: ins.task.requiresDeliverable,
      requiresOnsite: ins.task.requiresOnsite,
      requiresTwoStepReview: ins.task.requiresTwoStepReview,
      isRecurring: ins.task.isRecurring,
      recurrenceUnit: ins.task.recurrenceUnit,
      recurrenceInterval: ins.task.recurrenceInterval,
      estimateDays: ins.task.estimateDays,
      status: ins.status as WorkflowTaskStatus,
      assigneeId: ins.assigneeId,
      reviewStatus: ins.reviewStatus as WorkflowReviewStatus | null,
      reviewedById: ins.reviewedById,
      reviewedAt: ins.reviewedAt ? ins.reviewedAt.toISOString() : null,
      completedAt: ins.completedAt ? ins.completedAt.toISOString() : null,
      completedById: ins.completedById,
      remark: ins.remark,
      attachments: ins.attachments,
      parentInstanceId: ins.parentInstanceId,
      createdAt: ins.createdAt.toISOString(),
      updatedAt: ins.updatedAt.toISOString()
    });
    totals.total++;
    if (ins.status === "PENDING") totals.pending++;
    else if (ins.status === "IN_PROGRESS") totals.inProgress++;
    else if (ins.status === "COMPLETED") totals.completed++;
    else if (ins.status === "SKIPPED") totals.skipped++;
    else if (ins.status === "BLOCKED") totals.blocked++;
  }
  const stages = Array.from(stageMap.values()).sort((a, b) => a.sort - b.sort);
  for (const s of stages) s.tasks.sort((a, b) => a.sort - b.sort);

  return {
    templateId: template?.id ?? null,
    templateName: template?.name ?? null,
    serviceType: project.contract?.serviceType ?? null,
    stages,
    totals
  };
}

// =====================================================
// 任务实例:状态机动作
// =====================================================
export async function taskAction(
  user: SessionUser,
  instanceId: string,
  action: WorkflowTaskAction,
  opts: { remark?: string; attachments?: unknown } = {}
) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);
  const transition = TASK_TRANSITIONS[action];
  if (!transition) throw new ApiError(ERROR_CODES.WORKFLOW_TASK_INVALID_TRANSITION, "未知任务动作", 400);

  return prisma.$transaction(async (tx) => {
    const ins = await loadInstanceForUpdate(tx, user, instanceId);
    // 状态机校验
    if (!transition.from.includes(ins.status as WorkflowTaskStatus)) {
      throw new ApiError(
        ERROR_CODES.WORKFLOW_TASK_INVALID_TRANSITION,
        `当前状态 ${ins.status} 不允许 ${action}`,
        403
      );
    }
    // start: 自动指派给当前用户
    const data: Prisma.WorkflowTaskInstanceUpdateInput = { status: transition.to };
    if (action === "start" && !ins.assigneeId) data.assigneeId = user.id;
    if (action === "complete") {
      // 交付物校验
      if (ins.task.requiresDeliverable && !hasDeliverable(opts.attachments ?? ins.attachments)) {
        throw new ApiError(ERROR_CODES.WORKFLOW_DELIVERABLE_REQUIRED, "本任务需先上传至少一份交付物", 422);
      }
      // 报告类二审:校核+审核;complete 仅在校核通过后才能走(REVIEWED),否则要求先走 review.submit
      if (ins.task.requiresTwoStepReview && ins.reviewStatus !== "REVIEWED" && ins.reviewStatus !== "APPROVED") {
        throw new ApiError(ERROR_CODES.WORKFLOW_REVIEW_REQUIRED, "报告类任务需先校核再完成", 422);
      }
      data.completedAt = new Date();
      data.completedById = user.id;
      if (ins.task.requiresTwoStepReview) data.reviewStatus = "APPROVED";
    }
    if (opts.remark !== undefined) data.remark = opts.remark;
    if (opts.attachments !== undefined) {
      data.attachments = opts.attachments === null ? Prisma.JsonNull : (opts.attachments as Prisma.InputJsonValue);
    }
    const updated = await tx.workflowTaskInstance.update({ where: { id: instanceId }, data });
    await audit(tx, {
      actorId: user.id,
      action: `WORKFLOW_TASK_${action.toUpperCase()}`,
      entity: "WorkflowTaskInstance",
      entityId: instanceId,
      before: { status: ins.status, assigneeId: ins.assigneeId },
      after: { status: updated.status, assigneeId: updated.assigneeId }
    });
    return updated;
  });
}

// =====================================================
// 报告类二审:submit / approve / reject
// =====================================================
export async function reviewTask(
  user: SessionUser,
  instanceId: string,
  action: "submit" | "approve" | "reject",
  opts: { comment?: string } = {}
) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);
  const transition = REVIEW_TRANSITIONS[action];
  if (!transition) throw new ApiError(ERROR_CODES.WORKFLOW_TASK_INVALID_TRANSITION, "未知二审动作", 400);

  return prisma.$transaction(async (tx) => {
    const ins = await loadInstanceForUpdate(tx, user, instanceId);
    if (!ins.task.requiresTwoStepReview) {
      throw new ApiError(ERROR_CODES.WORKFLOW_TASK_INVALID_TRANSITION, "该任务非报告类,不需要二审", 400);
    }
    const cur = ins.reviewStatus as WorkflowReviewStatus | null;
    if (!transition.from.includes(cur as WorkflowReviewStatus | null)) {
      throw new ApiError(
        ERROR_CODES.WORKFLOW_TASK_INVALID_TRANSITION,
        `当前审阅状态 ${cur ?? "未提交"} 不允许 ${action}`,
        403
      );
    }
    const data: Prisma.WorkflowTaskInstanceUpdateInput = { reviewStatus: transition.to };
    if (action === "submit") {
      data.reviewedAt = null;
      data.reviewedById = null;
    } else {
      data.reviewedAt = new Date();
      data.reviewedById = user.id;
    }
    if (opts.comment) {
      // 二审备注拼到原 remark 后面,保留历史
      data.remark = ins.remark ? `${ins.remark}\n[${action}] ${opts.comment}` : `[${action}] ${opts.comment}`;
    }
    const updated = await tx.workflowTaskInstance.update({ where: { id: instanceId }, data });
    await audit(tx, {
      actorId: user.id,
      action: `WORKFLOW_REVIEW_${action.toUpperCase()}`,
      entity: "WorkflowTaskInstance",
      entityId: instanceId,
      before: { reviewStatus: cur },
      after: { reviewStatus: updated.reviewStatus }
    });
    return updated;
    // P2: submit 校核时通知项目负责人 + 管理员去审核
    if (action === "submit") {
      const receivers = new Set<string>([ins.project.managerUserId]);
      const admins = await tx.user.findMany({
        where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE" },
        select: { id: true }
      });
      for (const a of admins) receivers.add(a.id);
      receivers.delete(user.id);
      if (receivers.size > 0) {
        const submitter = await tx.user.findUnique({ where: { id: user.id }, select: { name: true } });
        await emit(tx, {
          type: "WORKFLOW_REVIEW_REQUESTED",
          payload: {
            projectId: ins.projectId,
            projectNo: ins.project.projectNo,
            taskName: ins.task.name,
            submittedByName: submitter?.name ?? user.name
          },
          receivers: Array.from(receivers)
        });
      }
    }

  });
}

// =====================================================
// 局部更新:指派 + 备注
// =====================================================
export async function assignTask(user: SessionUser, instanceId: string, assigneeId: string | null) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const ins = await loadInstanceForUpdate(tx, user, instanceId);
    if (assigneeId) {
      const exists = await tx.user.findFirst({ where: { id: assigneeId, deletedAt: null, status: "ACTIVE" } });
      if (!exists) throw new ApiError(ERROR_CODES.NOT_FOUND, "被指派用户不存在或已停用", 404);
    }
    const updated = await tx.workflowTaskInstance.update({
      where: { id: instanceId },
      data: { assigneeId }
    });
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TASK_ASSIGN",
      entity: "WorkflowTaskInstance",
      entityId: instanceId,
      before: { assigneeId: ins.assigneeId },
      after: { assigneeId }
    });
    // P2: 通知新指派人(指派人变化且非空时)
    if (assigneeId && assigneeId !== ins.assigneeId) {
      await emit(tx, {
        type: "WORKFLOW_TASK_ASSIGNED",
        payload: {
          projectId: ins.projectId,
          projectNo: ins.project.projectNo,
          taskName: ins.task.name,
          estimateDays: ins.task.estimateDays
        },
        receivers: [assigneeId]
      });
    }
    return updated;
  });
}

export async function updateTaskRemark(
  user: SessionUser,
  instanceId: string,
  opts: { remark?: string; attachments?: unknown }
) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const ins = await loadInstanceForUpdate(tx, user, instanceId);
    const data: Prisma.WorkflowTaskInstanceUpdateInput = {};
    if (opts.remark !== undefined) data.remark = opts.remark;
    if (opts.attachments !== undefined) {
      data.attachments = opts.attachments === null ? Prisma.JsonNull : (opts.attachments as Prisma.InputJsonValue);
    }
    const updated = await tx.workflowTaskInstance.update({ where: { id: instanceId }, data });
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TASK_REMARK",
      entity: "WorkflowTaskInstance",
      entityId: instanceId,
      before: { remark: ins.remark },
      after: { remark: updated.remark }
    });
    return updated;
  });
}

// =====================================================


// =====================================================
// 工具
// =====================================================
type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

async function loadInstanceForUpdate(tx: Tx, user: SessionUser, instanceId: string) {
  const ins = await tx.workflowTaskInstance.findFirst({
    where: { id: instanceId, deletedAt: null },
    include: { task: true, project: true }
  });
  if (!ins) throw new ApiError(ERROR_CODES.WORKFLOW_TASK_NOT_FOUND, "工作流任务实例不存在", 404);
  // SALES 行级隔离:跨合同不可见
  if (user.roleCode === "SALES") {
    const contract = await tx.contract.findFirst({
      where: { id: ins.project.contractId, ownerUserId: user.id, deletedAt: null },
      select: { id: true }
    });
    if (!contract) {
      throw new ApiError(ERROR_CODES.FORBIDDEN, "无权访问该项目", 403);
    }
  }
  return ins;
}

function hasDeliverable(attachments: unknown): boolean {
  if (!attachments) return false;
  if (Array.isArray(attachments)) return attachments.length > 0;
  if (typeof attachments === "object") {
    const arr = (attachments as { items?: unknown[] }).items;
    return Array.isArray(arr) ? arr.length > 0 : Object.keys(attachments).length > 0;
  }
  return false;
}

// =====================================================
// P2 新增:时间感知的循环生成 + 跨项目批量(cron 友好)
// =====================================================

/** 把 recurrenceInterval/Unit 转成毫秒;非法返回 null */
function recurrenceToMs(interval: number, unit: string): number | null {
  switch (unit) {
    case "DAY":   return interval * 24 * 60 * 60 * 1000;
    case "WEEK":  return interval * 7 * 24 * 60 * 60 * 1000;
    case "MONTH": return interval * 30 * 24 * 60 * 60 * 1000; // 简化按 30 天
    case "YEAR":  return interval * 365 * 24 * 60 * 60 * 1000;
    default:      return null;
  }
}

/** 给定已完成/进行中的父实例,问:根据周期,下一个实例应该已经生成了吗? */
function isRecurrenceDue(
  ins: { completedAt: Date | null; status: string },
  task: { recurrenceInterval: number | null; recurrenceUnit: string | null; isRecurring: boolean },
  now: Date
): boolean {
  if (!task.isRecurring) return false;
  if (ins.status !== "COMPLETED") return false; // 上一轮没完,不生下一轮
  if (!ins.completedAt) return false;
  if (task.recurrenceInterval == null || task.recurrenceUnit == null) return false;
  const ms = recurrenceToMs(task.recurrenceInterval, task.recurrenceUnit);
  if (ms == null) return false;
  const elapsed = now.getTime() - ins.completedAt.getTime();
  return elapsed >= ms;
}

/** 内部 worker:在给定 tx 上为一个项目生成到期循环实例(无 user 上下文) */
async function generateDueForProject(
  tx: Prisma.TransactionClient,
  projectId: string,
  now: Date,
  actorId: string
): Promise<{ generated: number; items: { parentInstanceId: string; newInstanceId: string }[] }> {
  const project = await tx.project.findFirst({
    where: { id: projectId, deletedAt: null }
  });
  if (!project) return { generated: 0, items: [] };

  const instances = await tx.workflowTaskInstance.findMany({
    where: { projectId, deletedAt: null },
    include: { task: true }
  });
  const items: { parentInstanceId: string; newInstanceId: string }[] = [];
  for (const ins of instances) {
    if (!isRecurrenceDue(ins, ins.task, now)) continue;
    // 找最新同 task 的实例(它的 next 才是"下一个该生")
    const siblings = instances.filter((x) => x.taskId === ins.taskId);
    const latest = siblings[siblings.length - 1];
    if (!latest || latest.id !== ins.id) continue;
    // 已生过下一个,跳过
    const hasChild = await tx.workflowTaskInstance.findFirst({
      where: { parentInstanceId: ins.id, deletedAt: null }
    });
    if (hasChild) continue;

    const next = await tx.workflowTaskInstance.create({
      data: {
        projectId,
        taskId: ins.taskId,
        status: "PENDING",
        parentInstanceId: ins.id,
        assigneeId: null,
        reviewStatus: null,
        remark: null,
        attachments: Prisma.JsonNull
      }
    });
    items.push({ parentInstanceId: ins.id, newInstanceId: next.id });
  }
  if (items.length > 0) {
    await audit(tx, {
      actorId,
      action: "WORKFLOW_RECURRING_GENERATE",
      entity: "Project",
      entityId: projectId,
      after: { generated: items.length }
    });
  }
  return { generated: items.length, items };
}

/**
 * 旧版带 user 上下文的接口 — 保留兼容,内部走时间感知逻辑
 * 行为变化:以前 "completed/IN_PROGRESS 都生" → 现在 "仅 completed 且周期已到"
 */
export async function generateRecurringInstances(user: SessionUser, projectId: string) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null, ...(ownerViaContract(user) as Prisma.ProjectWhereInput) }
  });
  if (!project) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);
  const now = new Date();
  return prisma.$transaction(async (tx) => generateDueForProject(tx, projectId, now, user.id));
}

/** Cron 入口:扫描所有 active 项目,生成到期的循环实例;无 user 上下文 */
export async function generateAllRecurringInstances(now: Date = new Date()): Promise<{
  scanned: number;
  generated: number;
  perProject: { projectId: string; generated: number }[];
}> {
  const SYSTEM_ACTOR_ID = "system:cron";
  const projects = await prisma.project.findMany({
    where: { deletedAt: null, status: { in: ["PLANNED", "IN_PROGRESS", "SUSPENDED"] } },
    select: { id: true }
  });
  let total = 0;
  const perProject: { projectId: string; generated: number }[] = [];
  for (const p of projects) {
    const r = await prisma.$transaction(async (tx) => generateDueForProject(tx, p.id, now, SYSTEM_ACTOR_ID));
    if (r.generated > 0) {
      perProject.push({ projectId: p.id, generated: r.generated });
      total += r.generated;
    }
  }
  return { scanned: projects.length, generated: total, perProject };
}

// =====================================================
// P2:我的任务 inbox
// =====================================================
export type MyTaskDto = {
  id: string;
  taskName: string;
  taskDescription: string | null;
  status: WorkflowTaskStatus;
  reviewStatus: WorkflowReviewStatus | null;
  projectId: string;
  projectNo: string;
  projectName: string;
  phase: string;
  phaseName: string;
  requiresDeliverable: boolean;
  requiresTwoStepReview: boolean;
  isRecurring: boolean;
  estimateDays: number | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  projectStatus: string;
};

export async function getMyTasks(
  user: SessionUser,
  params: { statuses?: WorkflowTaskStatus[]; limit?: number } = {}
): Promise<{ total: number; items: MyTaskDto[] }> {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);
  const statuses = params.statuses && params.statuses.length > 0 ? params.statuses : ["PENDING", "IN_PROGRESS", "BLOCKED"];
  const limit = Math.min(params.limit ?? 50, 200);
  // SALES 行级隔离:只看自己合同挂的项目
  const where: Prisma.WorkflowTaskInstanceWhereInput = {
    assigneeId: user.id,
    deletedAt: null,
    status: { in: statuses },
    project: {
      deletedAt: null,
      ...(user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {})
    }
  };
  const [items, total] = await Promise.all([
    prisma.workflowTaskInstance.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: limit,
      include: {
        task: { include: { stage: true } },
        project: { select: { id: true, projectNo: true, name: true, status: true } }
      }
    }),
    prisma.workflowTaskInstance.count({ where })
  ]);
  return {
    total,
    items: items.map((ins) => ({
      id: ins.id,
      taskName: ins.task.name,
      taskDescription: ins.task.description,
      status: ins.status as WorkflowTaskStatus,
      reviewStatus: ins.reviewStatus as WorkflowReviewStatus | null,
      projectId: ins.projectId,
      projectNo: ins.project.projectNo,
      projectName: ins.project.name,
      phase: ins.task.stage.phase,
      phaseName: ins.task.stage.name,
      requiresDeliverable: ins.task.requiresDeliverable,
      requiresTwoStepReview: ins.task.requiresTwoStepReview,
      isRecurring: ins.task.isRecurring,
      estimateDays: ins.task.estimateDays,
      startedAt: ins.status === "IN_PROGRESS" || ins.status === "COMPLETED" ? ins.updatedAt.toISOString() : null,
      completedAt: ins.completedAt ? ins.completedAt.toISOString() : null,
      updatedAt: ins.updatedAt.toISOString(),
      projectStatus: ins.project.status
    }))
  };
}

// =====================================================
// P2:Admin 视角的工作流概览(统计面板)
// =====================================================
export type WorkflowOverview = {
  totals: {
    projects: number;
    activeTasks: number;
    blockedTasks: number;
    inReview: number;
    overdue: number; // 超过 estimateDays 仍未 COMPLETED 的 IN_PROGRESS
  };
  byStatus: { status: WorkflowTaskStatus; count: number }[];
  byServiceType: { serviceType: string; activeTasks: number; projects: number }[];
};

export async function getWorkflowOverview(user: SessionUser): Promise<WorkflowOverview> {
  // 只给管理员
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可查看工作流概览", 403);
  }
  const [byStatus, activeProjects, blocked, reviewing] = await Promise.all([
    prisma.workflowTaskInstance.groupBy({
      by: ["status"],
      where: { deletedAt: null },
      _count: { _all: true }
    }),
    prisma.project.count({
      where: { deletedAt: null, status: { in: ["PLANNED", "IN_PROGRESS", "SUSPENDED"] } }
    }),
    prisma.workflowTaskInstance.count({ where: { status: "BLOCKED", deletedAt: null } }),
    prisma.workflowTaskInstance.count({ where: { reviewStatus: "REVIEWING", deletedAt: null } }),
    prisma.project.count({ where: { deletedAt: null } }),
  
  ]);

  // 超期:IN_PROGRESS + updatedAt - createdAt > 估算天数 → 视为"超期风险"
  // 用简化方法:updatedAt 距今 N 天(项目起期 ~ 任务起期)
  const candidateOverdue = await prisma.workflowTaskInstance.findMany({
    where: { status: "IN_PROGRESS", deletedAt: null },
    include: { task: true }
  });
  const now = Date.now();
  let overdue = 0;
  for (const c of candidateOverdue) {
    if (!c.task.estimateDays) continue;
    const elapsedDays = (now - c.createdAt.getTime()) / (24 * 60 * 60 * 1000);
    if (elapsedDays > c.task.estimateDays) overdue++;
  }

  const byStatusArr: { status: WorkflowTaskStatus; count: number }[] = byStatus.map((b) => ({
    status: b.status as WorkflowTaskStatus,
    count: b._count._all
  }));
  const activeTasks = byStatusArr
    .filter((b) => b.status === "PENDING" || b.status === "IN_PROGRESS")
    .reduce((s, b) => s + b.count, 0);

  // 按 serviceType 聚合:一次 query 完成
  const byServiceProjectRaw = await prisma.project.findMany({
    where: { deletedAt: null, status: { in: ["PLANNED", "IN_PROGRESS", "SUSPENDED"] } },
    select: {
      id: true,
      contract: { select: { serviceType: true } },
      _count: { select: { taskInstances: { where: { deletedAt: null, status: { in: ["PENDING", "IN_PROGRESS"] } } } } }
    }
  });
  const byServiceType: { serviceType: string; activeTasks: number; projects: number }[] = [];
  for (const p of byServiceProjectRaw) {
    const st = p.contract?.serviceType ?? "OTHER";
    byServiceType.push({ serviceType: st, activeTasks: p._count.taskInstances, projects: 1 });
  }
  // 合并相同 serviceType
  const merged = new Map<string, { serviceType: string; activeTasks: number; projects: number }>();
  for (const r of byServiceType) {
    if (!merged.has(r.serviceType)) merged.set(r.serviceType, { serviceType: r.serviceType, activeTasks: 0, projects: 0 });
    const m = merged.get(r.serviceType)!;
    m.activeTasks += r.activeTasks;
    m.projects += r.projects;
  }
  const byServiceTypeArr = Array.from(merged.values()).sort((a, b) => b.activeTasks - a.activeTasks);

  return {
    totals: {
      projects: activeProjects,
      activeTasks,
      blockedTasks: blocked,
      inReview: reviewing,
      overdue
    },
    byStatus: byStatusArr.sort((a, b) => b.count - a.count),
    byServiceType: byServiceTypeArr
  };
}
