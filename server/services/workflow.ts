// 工作流引擎 — 业务服务层(P1)
// P0 已落 4 张表 + 9 份激活模板 seed;P1 接管运行时:
// - instantiateProjectWorkflow  按合同 serviceType 克隆模板 → 任务实例
// - getProjectWorkflow          读项目全量实例(按阶段+任务组装返回给前端)
// - taskAction                  实例状态机(PENDING→IN_PROGRESS→COMPLETED 等)
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
import { WORKFLOW_PHASE_ORDER, type WorkflowPhase, type WorkflowTaskAction, type WorkflowTaskStatus, type WorkflowReviewStatus, type WorkflowPhaseState } from "@/types/enums";
import { computePhaseView, pickMajorityTemplateId, WORKFLOW_PHASE_TO_CN } from "@/lib/workflow-view";

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

// =====================================================
// 实例化模板 → 项目
// =====================================================
export async function instantiateProjectWorkflow(
  user: SessionUser,
  projectId: string,
  opts: { force?: boolean; tx?: Prisma.TransactionClient } = {}
) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);

  const run = async (tx: Prisma.TransactionClient) => {
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
  };

  if (opts.tx) {
    return run(opts.tx);
  }
  return prisma.$transaction(run);
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
      status: WorkflowTaskStatus;
      assigneeId: string | null;
      completedAt: string | null;
      completedById: string | null;
      remark: string | null;
      createdAt: string;
      updatedAt: string;
      projectId: string;
      projectNo: string;
      projectName: string;
    }>;
  }>;
  totals: { total: number; pending: number; inProgress: number; completed: number; skipped: number; blocked: number };
  phaseStates: Array<{
    phase: string;
    state: WorkflowPhaseState;
    completed: number;
    total: number;
    lockReason?: string;
  }>;
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
    include: { task: { include: { stage: true } }, project: { select: { id: true, projectNo: true, name: true } } }
  });

  if (instances.length === 0) {
    return {
      templateId: null,
      templateName: null,
      serviceType: project.contract?.serviceType ?? null,
      stages: [],
      totals: { total: 0, pending: 0, inProgress: 0, completed: 0, skipped: 0, blocked: 0 },
      phaseStates: WORKFLOW_PHASE_ORDER.map((ph) => ({ phase: ph, state: "READY" as WorkflowPhaseState, completed: 0, total: 0 }))
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
      status: ins.status as WorkflowTaskStatus,
      assigneeId: ins.assigneeId,
      completedAt: ins.completedAt ? ins.completedAt.toISOString() : null,
      completedById: ins.completedById,
      remark: ins.remark,
      createdAt: ins.createdAt.toISOString(),
      updatedAt: ins.updatedAt.toISOString(),
      projectId: ins.projectId,
      projectNo: ins.project.projectNo,
      projectName: ins.project.name
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

  // P3: 阶段顺序状态(供 UI 展示锁定/进度) — 共享 helper
  // PARTIAL 判定沿用旧 computePhaseStatesForProject 语义:必须有完成项才算"已开工"
  const phaseView = computePhaseView(instances, { isPartial: (pv) => pv.completed > 0 });
  const emptyPv: { state: WorkflowPhaseState; completed: number; total: number; lockReason?: string } = {
    state: "READY",
    completed: 0,
    total: 0
  };
  const phaseStates: ProjectWorkflowDto["phaseStates"] = WORKFLOW_PHASE_ORDER.map((ph) => {
    const pv = phaseView.get(ph) ?? emptyPv;
    return {
      phase: ph,
      state: pv.state,
      completed: pv.completed,
      total: pv.total,
      ...(pv.lockReason ? { lockReason: pv.lockReason } : {})
    };
  });

  return {
    templateId: template?.id ?? null,
    templateName: template?.name ?? null,
    serviceType: project.contract?.serviceType ?? null,
    stages,
    totals,
    phaseStates
  };
}

// =====================================================
// 任务实例:状态机动作
// =====================================================
export async function taskAction(
  user: SessionUser,
  instanceId: string,
  action: WorkflowTaskAction,
  opts: { remark?: string } = {}
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
    // P3: start 时做阶段顺序锁定校验
    if (action === "start") {
      // 复检:ins 来自 loadInstanceForUpdate 已 include task 但没 include stage;此处显式补
      const stage = await tx.workflowStage.findUniqueOrThrow({ where: { id: ins.task.stageId }, select: { phase: true, isRequired: true } });
      const lock = await checkPhaseLock(tx, { projectId: ins.projectId, task: { stage: { phase: stage.phase, isRequired: stage.isRequired } } });
      if (!lock.ok) {
        throw new ApiError(
          ERROR_CODES.WORKFLOW_PHASE_LOCKED,
          `阶段「${WORKFLOW_PHASE_TO_CN[stage.phase] ?? stage.phase}」尚未解锁:${lock.reason}`,
          422
        );
      }
    }
    // start: 自动指派给当前用户
    const data: Prisma.WorkflowTaskInstanceUpdateInput = { status: transition.to };
    if (action === "start" && !ins.assigneeId) data.assigneeId = user.id;
    if (action === "complete") {
      data.completedAt = new Date();
      data.completedById = user.id;
    }
    if (opts.remark !== undefined) data.remark = opts.remark;
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
// P3: 阶段顺序锁定
// =====================================================
type PhaseLockResult = { ok: true } | { ok: false; reason: string };

/**
 * 检查启动 ins 任务时,前一阶段是否已"解锁"
 * - 首阶段 PREP:永远 OK
 * - 同阶段内任务:互相独立,不影响
 * - 阶段 N 的任务要 start,要求所有阶段 N-1 中 stage.isRequired=true 的任务
 *   都为 COMPLETED 或 SKIPPED(非 required 阶段不阻塞)
 */
async function checkPhaseLock(
  tx: Prisma.TransactionClient,
  ins: { projectId: string; task: { stage: { phase: string; isRequired: boolean } } }
): Promise<PhaseLockResult> {
  const cur = ins.task.stage.phase;
  const idx = WORKFLOW_PHASE_ORDER.indexOf(cur as WorkflowPhase);
  if (idx <= 0) return { ok: true }; // PREP 或未知阶段都放行
  const prevPhase = WORKFLOW_PHASE_ORDER[idx - 1]!;
  // 找前一阶段所有 stage 的 required 任务
  // 查当前项目下、阶段 N-1、required 阶段中的未完成实例
  const unfinished = await tx.workflowTaskInstance.findMany({
    where: {
      projectId: ins.projectId,
      status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] },
      deletedAt: null,
      task: {
        // required 在 stage 上(整个阶段 required=true 时,所有任务都视为 required)
        stage: { phase: prevPhase, isRequired: true }
      }
    },
    select: { id: true, task: { select: { name: true } } }
  });
  if (unfinished.length === 0) return { ok: true };
  return {
    ok: false,
    reason: `前一阶段「${WORKFLOW_PHASE_TO_CN[prevPhase] ?? prevPhase}」还有 ${unfinished.length} 项任务未完成(${unfinished[0]!.task.name}${unfinished.length > 1 ? ` 等` : ""})`
  };
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
): Promise<{ generated: number; skipped: number; items: { parentInstanceId: string; newInstanceId: string }[] }> {
  const project = await tx.project.findFirst({
    where: { id: projectId, deletedAt: null }
  });
  if (!project) return { generated: 0, skipped: 0, items: [] };

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

    // 止期护栏:若按当前周期推算的"下一个完成时间"会越过项目 endDate,跳过生成并审计
    if (project.endDate && ins.task.recurrenceInterval != null && ins.task.recurrenceUnit != null) {
      const unitMs = recurrenceToMs(ins.task.recurrenceInterval, ins.task.recurrenceUnit);
      if (unitMs != null) {
        const nextCompletedAt = new Date(Date.now() + unitMs);
        if (nextCompletedAt > project.endDate) {
          await audit(tx, {
            actorId,
            action: "WORKFLOW_RECURRING_SKIPPED_PROJECT_ENDED",
            entity: "Project",
            entityId: projectId,
            after: { taskId: ins.taskId, wouldCompleteAt: nextCompletedAt, projectEndDate: project.endDate }
          });
          continue;
        }
      }
    }
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
  // 止期护栏:扫一遍因 endDate 跳过的实例
  const skipped = instances.filter((ins) => {
    if (!isRecurrenceDue(ins, ins.task, now)) return false;
    const siblings = instances.filter((x) => x.taskId === ins.taskId);
    const latest = siblings[siblings.length - 1];
    if (!latest || latest.id !== ins.id) return false;
    if (items.some((it) => it.parentInstanceId === ins.id)) return false;
    if (!project.endDate) return false;
    if (ins.task.recurrenceInterval == null || ins.task.recurrenceUnit == null) return false;
    const unitMs = recurrenceToMs(ins.task.recurrenceInterval, ins.task.recurrenceUnit);
    if (unitMs == null) return false;
    const nextCompletedAt = new Date(Date.now() + unitMs);
    return nextCompletedAt > project.endDate;
  }).length;

  if (items.length > 0) {
    await audit(tx, {
      actorId,
      action: "WORKFLOW_RECURRING_GENERATE",
      entity: "Project",
      entityId: projectId,
      after: { generated: items.length, skipped }
    });
  }
  return { generated: items.length, skipped, items };
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
  skipped: number;
  perProject: { projectId: string; generated: number; skipped: number }[];
}> {
  const SYSTEM_ACTOR_ID = "system:cron";
  // P13 优化:批量跨项目查询最近完成的循环任务实例,仅处理有到期任务的活跃项目
  const activeProjects = await prisma.project.findMany({
    where: { deletedAt: null, status: { in: ["PLANNED", "IN_PROGRESS", "SUSPENDED"] } },
    select: { id: true }
  });
  const activeProjectIds = activeProjects.map((p) => p.id);
  if (activeProjectIds.length === 0) return { scanned: 0, generated: 0, skipped: 0, perProject: [] };

  // 一次查询所有活跃项目中已完成且有循环任务的实例
  const completedRecurring = await prisma.workflowTaskInstance.findMany({
    where: {
      projectId: { in: activeProjectIds },
      deletedAt: null,
      status: "COMPLETED",
      completedAt: { not: null },
      task: { isRecurring: true, recurrenceInterval: { not: null }, recurrenceUnit: { not: null } }
    },
    include: { task: true },
    orderBy: [{ projectId: "asc" }, { createdAt: "asc" }]
  });

  // 按项目分组,仅对有到期任务的项目处理
  const projectTasks = new Map<string, typeof completedRecurring>();
  const candidateSet = new Set<string>();
  for (const ins of completedRecurring) {
    if (!isRecurrenceDue(ins, ins.task, now)) continue;
    // 检查是否已有子实例
    const siblings = completedRecurring.filter((x) => x.projectId === ins.projectId && x.taskId === ins.taskId && x.parentInstanceId === ins.id);
    if (siblings.length > 0) continue;
    // 检查是否是该项目该任务的最新实例
    const sameTask = completedRecurring.filter((x) => x.projectId === ins.projectId && x.taskId === ins.taskId);
    const latest = sameTask[sameTask.length - 1];
    if (!latest || latest.id !== ins.id) continue;
    candidateSet.add(ins.projectId);
    const arr = projectTasks.get(ins.projectId) ?? [];
    arr.push(ins);
    projectTasks.set(ins.projectId, arr);
  }

  const candidateProjects = activeProjects.filter((p) => candidateSet.has(p.id));
  if (candidateProjects.length === 0) return { scanned: activeProjects.length, generated: 0, skipped: 0, perProject: [] };

  let total = 0;
  let totalSkipped = 0;
  const perProject: { projectId: string; generated: number; skipped: number }[] = [];
  for (const p of candidateProjects) {
    const r = await prisma.$transaction(async (tx) => generateDueForProject(tx, p.id, now, SYSTEM_ACTOR_ID));
    if (r.generated > 0 || r.skipped > 0) {
      perProject.push({ projectId: p.id, generated: r.generated, skipped: r.skipped });
    }
    total += r.generated;
    totalSkipped += r.skipped;
  }
  return { scanned: candidateProjects.length, generated: total, skipped: totalSkipped, perProject };
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

// =====================================================
// P3:超期任务清单(管理员 / 当前用户视角)
// =====================================================
export type OverdueTaskDto = {
  id: string;
  taskName: string;
  projectId: string;
  projectNo: string;
  projectName: string;
  phase: string;
  assigneeId: string | null;
  assigneeName: string | null;
  status: WorkflowTaskStatus;
  reviewStatus: WorkflowReviewStatus | null;
  startedAt: string | null;
  estimateDays: number;
  elapsedDays: number;
  overdueDays: number;
};

export async function getOverdueTasks(
  user: SessionUser,
  params: { limit?: number } = {}
): Promise<{ total: number; items: OverdueTaskDto[] }> {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);
  const limit = Math.min(params.limit ?? 50, 200);

  const where: Prisma.WorkflowTaskInstanceWhereInput = {
    status: "IN_PROGRESS",
    deletedAt: null,
    task: { estimateDays: { not: null } },
    ...(user.roleCode === "SALES" ? { project: { contract: { ownerUserId: user.id } } } : {})
  };
  const candidates = await prisma.workflowTaskInstance.findMany({
    where,
    include: {
      task: { include: { stage: { select: { phase: true } } } },
      project: { select: { id: true, projectNo: true, name: true } }
    },
    take: limit
  });
  const now = Date.now();
  const items: OverdueTaskDto[] = [];
  for (const c of candidates) {
    if (!c.task.estimateDays) continue;
    const elapsedDays = (now - c.createdAt.getTime()) / (24 * 60 * 60 * 1000);
    const overdueDays = elapsedDays - c.task.estimateDays;
    if (overdueDays <= 0) continue;
    // 取指派人姓名
    let assigneeName: string | null = null;
    if (c.assigneeId) {
      const u = await prisma.user.findUnique({ where: { id: c.assigneeId }, select: { name: true } });
      assigneeName = u?.name ?? null;
    }
    items.push({
      id: c.id,
      taskName: c.task.name,
      projectId: c.projectId,
      projectNo: c.project.projectNo,
      projectName: c.project.name,
      phase: c.task.stage.phase,
      assigneeId: c.assigneeId,
      assigneeName,
      status: c.status as WorkflowTaskStatus,
      reviewStatus: c.reviewStatus as WorkflowReviewStatus | null,
      startedAt: c.updatedAt.toISOString(),
      estimateDays: c.task.estimateDays,
      elapsedDays: Math.floor(elapsedDays),
      overdueDays: Math.floor(overdueDays)
    });
  }
  items.sort((a, b) => b.overdueDays - a.overdueDays);
  return { total: items.length, items };
}

// =====================================================
// P4: 任务实例活动时间线(查 OperationLog)
// =====================================================
export type HistoryEntry = {
  id: string;
  action: string;
  actorId: string;
  actorName: string | null;
  at: string;
  diff: { before: unknown; after: unknown } | null;
  /** 项目级动作(如 WORKFLOW_INSTANTIATE)没有关联任务实例,此时 instanceId = null */
  instanceId: string | null;
  taskName: string | null;
  taskCode: string | null;
};

const WORKFLOW_INSTANCE_ACTIONS = new Set([
  "WORKFLOW_INSTANTIATE",
  "WORKFLOW_TASK_START",
  "WORKFLOW_TASK_COMPLETE",
  "WORKFLOW_TASK_BLOCK",
  "WORKFLOW_TASK_UNBLOCK",
  "WORKFLOW_TASK_SKIP",
  "WORKFLOW_TASK_ASSIGN",
  "WORKFLOW_TASK_REMARK",
  "WORKFLOW_REVIEW_SUBMIT",
  "WORKFLOW_REVIEW_APPROVE",
  "WORKFLOW_REVIEW_REJECT",
  "WORKFLOW_RECURRING_GENERATE"
]);

export async function getTaskHistory(user: SessionUser, instanceId: string): Promise<{ items: HistoryEntry[] }> {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);
  // 行级隔离 + 实例查询统一走 loadInstanceForUpdate(SALES 走合同 owner 校验,非 SALES 直通)
  const ins = await loadInstanceForUpdate(prisma, user, instanceId);
  // 查 OperationLog: 自身 + 父实例(循环生成) + 项目级动作(如 instantiate)
  const candidateIds = [instanceId];
  if (ins.parentInstanceId) candidateIds.push(ins.parentInstanceId);
  // 找该项目下的所有相关 log(主要是 WORKFLOW_INSTANTIATE / WORKFLOW_RECURRING_GENERATE)
  const allInstanceIds = await prisma.workflowTaskInstance.findMany({
    where: { projectId: ins.projectId, deletedAt: null },
    select: { id: true }
  });
  candidateIds.push(...allInstanceIds.map((x) => x.id));
  // 操作人姓名批量查询
  const logs = await prisma.operationLog.findMany({
    where: {
      OR: [
        { entity: "WorkflowTaskInstance", entityId: { in: candidateIds } },
        { entity: "Project", entityId: ins.projectId, action: "WORKFLOW_INSTANTIATE" }
      ],
      action: { in: Array.from(WORKFLOW_INSTANCE_ACTIONS) }
    },
    orderBy: { at: "desc" },
    take: 100
  });
  const actorIds = Array.from(new Set(logs.map((l) => l.actorId)));
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true }
  });
  const actorMap = new Map(actors.map((a) => [a.id, a.name]));
  return {
    items: logs.map((l) => ({
      id: l.id,
      action: l.action,
      actorId: l.actorId,
      actorName: actorMap.get(l.actorId) ?? null,
      at: l.at.toISOString(),
      diff: l.diff ? (l.diff as { before: unknown; after: unknown }) : null,
      instanceId: l.entity === "WorkflowTaskInstance" ? l.entityId : null,
      taskName: null,
      taskCode: null
    }))
  };
}

/**
 * 读整个项目下的工作流活动流(项目级 + 所有任务实例)
 * - 项目级动作:WORKFLOW_INSTANTIATE / WORKFLOW_RECURRING_GENERATE / WORKFLOW_RECURRING_SKIPPED_PROJECT_ENDED
 * - 任务实例级:start / complete / block / unblock / skip / assign / remark / 附件增删 / 校核
 * - 每条都补 instanceId / taskName / taskCode,前端无须再做一次反查
 */
export async function getProjectHistory(user: SessionUser, projectId: string): Promise<{ items: HistoryEntry[] }> {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);
  // 行级隔离:SALES 走 ownerUserId 校验,非 SALES 直通
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      ...(ownerViaContract(user) as Prisma.ProjectWhereInput)
    },
    select: { id: true }
  });
  if (!project) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);

  // 项目下所有未删实例的 id + task 名/码(用于 diff 行上下文)
  const allInstances = await prisma.workflowTaskInstance.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true, task: { select: { name: true, code: true } } }
  });
  const allInstanceIds = allInstances.map((x) => x.id);
  const instanceNameMap = new Map(allInstances.map((x) => [x.id, { name: x.task.name, code: x.task.code }]));

  // 项目级 + 任务实例级的所有 log
  const logs = await prisma.operationLog.findMany({
    where: {
      OR: [
        { entity: "Project", entityId: projectId, action: { in: Array.from(WORKFLOW_INSTANCE_ACTIONS) } },
        ...(allInstanceIds.length > 0
          ? [{ entity: "WorkflowTaskInstance", entityId: { in: allInstanceIds } }]
          : [])
      ]
    },
    orderBy: { at: "desc" },
    take: 200
  });

  // 操作人姓名批量查询
  const actorIds = Array.from(new Set(logs.map((l) => l.actorId)));
  const actors = await prisma.user.findMany({
    where: { id: { in: actorIds } },
    select: { id: true, name: true }
  });
  const actorMap = new Map(actors.map((a) => [a.id, a.name]));

  return {
    items: logs.map((l) => {
      const isTaskLog = l.entity === "WorkflowTaskInstance";
      const meta = isTaskLog ? instanceNameMap.get(l.entityId) : null;
      return {
        id: l.id,
        action: l.action,
        actorId: l.actorId,
        actorName: actorMap.get(l.actorId) ?? null,
        at: l.at.toISOString(),
        diff: l.diff ? (l.diff as { before: unknown; after: unknown }) : null,
        instanceId: isTaskLog ? l.entityId : null,
        taskName: meta?.name ?? null,
        taskCode: meta?.code ?? null
      };
    })
  };
}

// =====================================================
// P5: 任务附件管理 + 实例迁移
// =====================================================
type AttachmentItem = { id: string; name: string; mimeType: string; size: number; uploadedBy?: string; uploadedAt?: string };

export function readAttachments(att: unknown): AttachmentItem[] {
  if (!att) return [];
  if (Array.isArray(att)) return att as AttachmentItem[];
  if (typeof att === "object") {
    const items = (att as { items?: unknown }).items;
    if (Array.isArray(items)) return items as AttachmentItem[];
  }
  return [];
}

function writeAttachments(items: AttachmentItem[]): Prisma.InputJsonValue {
  return { items } as Prisma.InputJsonValue;
}

export async function addTaskAttachment(
  user: SessionUser,
  instanceId: string,
  attachmentId: string
): Promise<{ id: string; attachments: AttachmentItem[] }> {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const ins = await loadInstanceForUpdate(tx, user, instanceId);
    // 校验 attachment 存在(不限定 contractId/invoiceId,允许工作流附件)
    const att = await tx.attachment.findFirst({ where: { id: attachmentId, deletedAt: null } });
    if (!att) throw new ApiError(ERROR_CODES.NOT_FOUND, "附件不存在", 404);
    const items = readAttachments(ins.attachments);
    if (items.some((x) => x.id === attachmentId)) {
      return { id: ins.id, attachments: items }; // idempotent
    }
    const newItem: AttachmentItem = {
      id: att.id,
      name: att.originalName,
      mimeType: att.mimeType,
      size: att.size,
      uploadedBy: user.id,
      uploadedAt: new Date().toISOString()
    };
    const next = [...items, newItem];
    const updated = await tx.workflowTaskInstance.update({
      where: { id: instanceId },
      data: { attachments: writeAttachments(next) }
    });
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TASK_ATTACHMENT_ADD",
      entity: "WorkflowTaskInstance",
      entityId: instanceId,
      after: { attachmentId, name: att.originalName }
    });
    return { id: updated.id, attachments: next };
  });
}

export async function removeTaskAttachment(
  user: SessionUser,
  instanceId: string,
  attachmentId: string
): Promise<{ id: string; attachments: AttachmentItem[] }> {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const ins = await loadInstanceForUpdate(tx, user, instanceId);
    const items = readAttachments(ins.attachments);
    const next = items.filter((x) => x.id !== attachmentId);
    if (next.length === items.length) {
      return { id: ins.id, attachments: items }; // idempotent
    }
    const updated = await tx.workflowTaskInstance.update({
      where: { id: instanceId },
      data: { attachments: writeAttachments(next) }
    });
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TASK_ATTACHMENT_REMOVE",
      entity: "WorkflowTaskInstance",
      entityId: instanceId,
      before: { attachmentId }
    });
    return { id: updated.id, attachments: next };
  });
}

// =====================================================
// P8: 项目工作流升级检查
// =====================================================
import { diffTemplates as diffTemplatesSvc } from "./workflow-template";

export type UpgradeCheckResult = {
  needsUpgrade: boolean;
  reason: "no-template" | "no-active-version" | "no-instances" | "same-version" | "older-version" | "already-latest";
  current: { id: string; name: string; version: number; taskCount: number; instanceCount: number } | null;
  latest: { id: string; name: string; version: number; taskCount: number } | null;
  serviceType: string | null;
  /** 仅在 needsUpgrade=true 时填充(从 latest 到 current) */
  diff: Awaited<ReturnType<typeof diffTemplatesSvc>> | null;
};

export async function getProjectUpgradeCheck(
  user: SessionUser,
  projectId: string
): Promise<UpgradeCheckResult> {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null, ...(ownerViaContract(user) as Prisma.ProjectWhereInput) },
    include: {
      contract: { select: { serviceType: true } },
      taskInstances: { where: { deletedAt: null }, select: { id: true, task: { select: { stageId: true } } } }
    }
  });
  if (!project) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);
  const serviceType = project.contract?.serviceType ?? null;
  if (!serviceType) {
    return { needsUpgrade: false, reason: "no-template", current: null, latest: null, serviceType: null, diff: null };
  }
  // 1. 当前项目用的模板:从 instance.task.stage.templateId 反推,取最常见那个
  //    (理论上同 serviceType 下所有 task 都来自同一 active 模板)
  const allInstances = await prisma.workflowTaskInstance.findMany({
    where: { projectId, deletedAt: null },
    include: { task: { include: { stage: { select: { templateId: true } } } } }
  });
  const currentTplId = pickMajorityTemplateId(allInstances);
  // 2. 最新激活模板
  const latestTpl = await prisma.workflowTemplate.findFirst({
    where: { serviceType, isActive: true, deletedAt: null },
    include: { _count: { select: { stages: true } } }
  });
  // 查 latest 的 task 总数
  const latestTaskCount = latestTpl
    ? await prisma.workflowTask.count({ where: { stage: { templateId: latestTpl.id } } })
    : 0;
  const currentTpl = currentTplId
    ? await prisma.workflowTemplate.findUnique({ where: { id: currentTplId } })
    : null;
  const currentTaskCount = currentTplId
    ? await prisma.workflowTask.count({ where: { stage: { templateId: currentTplId } } })
    : null;
  if (allInstances.length === 0) {
    return {
      needsUpgrade: false,
      reason: "no-instances",
      current: null,
      latest: latestTpl ? { id: latestTpl.id, name: latestTpl.name, version: latestTpl.version, taskCount: latestTaskCount } : null,
      serviceType,
      diff: null
    };
  }
  if (!latestTpl) {
    return {
      needsUpgrade: false,
      reason: "no-active-version",
      current: currentTpl
        ? { id: currentTpl.id, name: currentTpl.name, version: currentTpl.version, taskCount: currentTaskCount ?? 0, instanceCount: allInstances.length }
        : null,
      latest: null,
      serviceType,
      diff: null
    };
  }
  if (currentTplId === latestTpl.id) {
    return {
      needsUpgrade: false,
      reason: "already-latest",
      current: currentTpl
        ? { id: currentTpl.id, name: currentTpl.name, version: currentTpl.version, taskCount: currentTaskCount ?? 0, instanceCount: allInstances.length }
        : null,
      latest: { id: latestTpl.id, name: latestTpl.name, version: latestTpl.version, taskCount: latestTaskCount },
      serviceType,
      diff: null
    };
  }
  // 不同 — 算 diff
  const diff = await diffTemplatesSvc(user, currentTplId ?? latestTpl.id, latestTpl.id);
  return {
    needsUpgrade: true,
    reason: currentTpl && currentTpl.version < latestTpl.version ? "older-version" : "same-version",
    current: currentTpl
      ? { id: currentTpl.id, name: currentTpl.name, version: currentTpl.version, taskCount: currentTaskCount ?? 0, instanceCount: allInstances.length }
      : null,
    latest: { id: latestTpl.id, name: latestTpl.name, version: latestTpl.version, taskCount: latestTaskCount },
    serviceType,
    diff
  };
}

// =====================================================
// P9: 任务批量操作
// - action: "start" | "complete" | "block" | "unblock" | "skip" | "assign"
// - 每条独立 try,失败返回 errors[],成功返回 succeeded
// =====================================================
export type BatchActionResult = {
  succeeded: string[];
  failed: { id: string; errorCode?: string; message: string }[];
};

export async function batchTaskAction(
  user: SessionUser,
  taskIds: string[],
  action: WorkflowTaskAction | "assign",
  opts: { assigneeId?: string | null; remark?: string } = {}
): Promise<BatchActionResult> {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);
  const succeeded: string[] = [];
  const failed: { id: string; errorCode?: string; message: string }[] = [];
  for (const id of taskIds) {
    try {
      if (action === "assign") {
        await assignTask(user, id, opts.assigneeId ?? null);
      } else {
        await taskAction(user, id, action, { remark: opts.remark });
      }
      succeeded.push(id);
    } catch (e) {
      const err = e as { errorCode?: string; message?: string };
      failed.push({ id, errorCode: err.errorCode, message: err.message ?? "未知错误" });
    }
  }
  return { succeeded, failed };
}

// =====================================================
// P9: 看板视图 — 按 phase 分组任务,带状态小计
// =====================================================
export type KanbanColumn = {
  phase: string;
  code: string;
  name: string;
  total: number;
  byStatus: { PENDING: number; IN_PROGRESS: number; BLOCKED: number; COMPLETED: number; SKIPPED: number };
  /** 阶段状态:DONE / PARTIAL / LOCKED / READY */
  phaseState: "DONE" | "PARTIAL" | "LOCKED" | "READY";
  tasks: Array<{
    id: string;
    name: string;
    code: string;
    status: WorkflowTaskStatus;
    assigneeId: string | null;
    requiresTwoStepReview: boolean;
    reviewStatus: WorkflowReviewStatus | null;
    updatedAt: string;
  }>;
};

export type ProjectKanban = {
  projectId: string;
  projectName: string;
  projectNo: string;
  columns: KanbanColumn[];
  totals: { total: number; pending: number; inProgress: number; completed: number; blocked: number };
};

export async function getProjectKanban(user: SessionUser, projectId: string): Promise<ProjectKanban> {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      ...(ownerViaContract(user) as Prisma.ProjectWhereInput)
    }
  });
  if (!project) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);
  const instances = await prisma.workflowTaskInstance.findMany({
    where: { projectId, deletedAt: null },
    include: { task: { select: { name: true, code: true, requiresTwoStepReview: true, stage: { select: { id: true, phase: true, code: true, name: true, sort: true, isRequired: true } } } } },
    orderBy: [{ createdAt: "asc" }]
  });
  // 按 phase 分组
  const phaseMap = new Map<string, KanbanColumn>();
  const phaseOrder: string[] = [];
  for (const ins of instances) {
    const ph = ins.task.stage.phase;
    if (!phaseMap.has(ph)) {
      phaseMap.set(ph, {
        phase: ph,
        code: ins.task.stage.code,
        name: ins.task.stage.name,
        total: 0,
        byStatus: { PENDING: 0, IN_PROGRESS: 0, BLOCKED: 0, COMPLETED: 0, SKIPPED: 0 },
        phaseState: "READY",
        tasks: []
      });
      phaseOrder.push(ph);
    }
    const col = phaseMap.get(ph)!;
    col.total++;
    const s = ins.status as keyof typeof col.byStatus;
    if (s in col.byStatus) col.byStatus[s]++;
    col.tasks.push({
      id: ins.id,
      name: ins.task.name,
      code: ins.task.code,
      status: ins.status as WorkflowTaskStatus,
      assigneeId: ins.assigneeId,
      requiresTwoStepReview: ins.task.requiresTwoStepReview,
      reviewStatus: ins.reviewStatus as WorkflowReviewStatus | null,
      updatedAt: ins.updatedAt.toISOString()
    });
  }
  // 阶段状态 — 共享 helper;kanban 保留旧版"任意 active 即阻塞后续"的简化语义
  const phaseView = computePhaseView(instances, { isPhaseBlocking: (pv) => pv.anyActive });
  const orderedCols: KanbanColumn[] = [];
  for (const ph of WORKFLOW_PHASE_ORDER) {
    const col = phaseMap.get(ph);
    if (!col) continue;
    const pv = phaseView.get(ph);
    if (pv) col.phaseState = pv.state;
    orderedCols.push(col);
  }
  // 总计
  const totals = { total: 0, pending: 0, inProgress: 0, completed: 0, blocked: 0 };
  for (const c of orderedCols) {
    totals.total += c.total;
    totals.pending += c.byStatus.PENDING;
    totals.inProgress += c.byStatus.IN_PROGRESS;
    totals.completed += c.byStatus.COMPLETED;
    totals.blocked += c.byStatus.BLOCKED;
  }
  return {
    projectId: project.id,
    projectName: project.name,
    projectNo: project.projectNo,
    columns: orderedCols,
    totals
  };
}


// =====================================================
// P12: 项目工作流状态导出 — 完整 JSON 快照
// =====================================================
export type ProjectWorkflowExport = {
  exportedAt: string;
  project: {
    id: string;
    projectNo: string;
    name: string;
    serviceScope: string;
    status: string;
    startDate: string;
    endDate: string;
  };
  contract: {
    id: string;
    contractNo: string;
    title: string;
    serviceType: string;
  };
  template: {
    id: string;
    name: string;
    version: number;
    serviceType: string;
    description: string | null;
  } | null;
  stages: Array<{
    phase: string;
    code: string;
    name: string;
    isRequired: boolean;
    tasks: Array<{
      code: string;
      name: string;
      status: WorkflowTaskStatus;
      assigneeId: string | null;
      completedAt: string | null;
      completedById: string | null;
      remark: string | null;
      updatedAt: string;
    }>;
  }>;
  totals: {
    taskCount: number;
    pending: number;
    inProgress: number;
    blocked: number;
    completed: number;
    skipped: number;
  };
};

export async function exportProjectWorkflow(
  user: SessionUser,
  projectId: string
): Promise<ProjectWorkflowExport> {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null, ...(ownerViaContract(user) as Prisma.ProjectWhereInput) },
    include: {
      contract: { select: { id: true, contractNo: true, title: true, serviceType: true } },
      taskInstances: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        include: { task: { include: { stage: { select: { phase: true, code: true, name: true, sort: true, isRequired: true, templateId: true } } } } }
      }
    }
  });
  if (!project) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);

  // 取项目当前用的模板(从 instance.task.stage.templateId 反推,取多数派)
  const templateId = pickMajorityTemplateId(project.taskInstances);
  const template = templateId
    ? await prisma.workflowTemplate.findUnique({ where: { id: templateId } })
    : null;

  // 按 phase 分组
  const phaseMap = new Map<string, { phase: string; code: string; name: string; sort: number; isRequired: boolean; tasks: ProjectWorkflowExport["stages"][number]["tasks"] }>();
  for (const ins of project.taskInstances) {
    const ph = ins.task.stage.phase;
    if (!phaseMap.has(ph)) {
      phaseMap.set(ph, {
        phase: ph,
        code: ins.task.stage.code,
        name: ins.task.stage.name,
        sort: ins.task.stage.sort,
        isRequired: ins.task.stage.isRequired,
        tasks: []
      });
    }
    phaseMap.get(ph)!.tasks.push({
      code: ins.task.code,
      name: ins.task.name,
      status: ins.status as WorkflowTaskStatus,
      assigneeId: ins.assigneeId,
      completedAt: ins.completedAt ? ins.completedAt.toISOString() : null,
      completedById: ins.completedById,
      remark: ins.remark,
      updatedAt: ins.updatedAt.toISOString()
    });
  }
  const stages = Array.from(phaseMap.values())
    .sort((a, b) => a.sort - b.sort)
    .map((s) => ({ phase: s.phase, code: s.code, name: s.name, isRequired: s.isRequired, tasks: s.tasks }));

  // totals
  const totals = { taskCount: 0, pending: 0, inProgress: 0, blocked: 0, completed: 0, skipped: 0 };
  for (const s of stages) {
    for (const t of s.tasks) {
      totals.taskCount++;
      if (t.status === "PENDING") totals.pending++;
      else if (t.status === "IN_PROGRESS") totals.inProgress++;
      else if (t.status === "BLOCKED") totals.blocked++;
      else if (t.status === "COMPLETED") totals.completed++;
      else if (t.status === "SKIPPED") totals.skipped++;
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    project: {
      id: project.id,
      projectNo: project.projectNo,
      name: project.name,
      serviceScope: project.serviceScope,
      status: project.status,
      startDate: project.startDate.toISOString(),
      endDate: project.endDate.toISOString()
    },
    contract: {
      id: project.contract.id,
      contractNo: project.contract.contractNo,
      title: project.contract.title,
      serviceType: project.contract.serviceType
    },
    template: template
      ? { id: template.id, name: template.name, version: template.version, serviceType: template.serviceType, description: template.description }
      : null,
    stages,
    totals
  };
}
