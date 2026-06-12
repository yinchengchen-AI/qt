// P4: 工作流模板可视化编辑器服务层
// 让 admin 在 web 后台直接维护 WorkflowTemplate / Stage / Task
// 不再需要重跑 seed
// 注意:已 instantiate 的项目用的是"快照"——模板改了不影响已生成实例
//       要影响旧项目,需要管理员重新 init(force=true)或升级模板版本

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import { audit } from "@/server/audit";
import { WORKFLOW_RECURRENCE_UNIT } from "@/types/enums";

// =====================================================
// 列表 / 详情
// =====================================================

export async function listTemplates(user: SessionUser) {
  requirePermission(user.roleCode, RESOURCE.WORKFLOW_TEMPLATE, ACTION.READ);
  const templates = await prisma.workflowTemplate.findMany({
    where: { deletedAt: null },
    orderBy: [{ serviceType: "asc" }, { version: "desc" }],
    include: {
      _count: { select: { stages: true } },
      stages: { select: { id: true } }
    }
  });
  return templates.map((t) => ({
    id: t.id,
    serviceType: t.serviceType,
    name: t.name,
    version: t.version,
    isActive: t.isActive,
    description: t.description,
    stageCount: t._count.stages,
    taskCount: t.stages.length === 0 ? 0 : undefined, // 计算:下面查一次
    createdById: t.createdById,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString()
  }));
}

export async function getTemplate(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.WORKFLOW_TEMPLATE, ACTION.READ);
  const t = await prisma.workflowTemplate.findFirst({
    where: { id, deletedAt: null },
    include: {
      stages: {
        orderBy: { sort: "asc" },
        include: { tasks: { orderBy: { sort: "asc" } } }
      }
    }
  });
  if (!t) throw new ApiError(ERROR_CODES.NOT_FOUND, "模板不存在", 404);
  return {
    id: t.id,
    serviceType: t.serviceType,
    name: t.name,
    version: t.version,
    isActive: t.isActive,
    description: t.description,
    createdById: t.createdById,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    stages: t.stages.map((s) => ({
      id: s.id,
      phase: s.phase,
      code: s.code,
      name: s.name,
      sort: s.sort,
      description: s.description,
      isRequired: s.isRequired,
      taskCount: s.tasks.length,
      tasks: s.tasks.map((tk) => ({
        id: tk.id,
        code: tk.code,
        name: tk.name,
        sort: tk.sort,
        description: tk.description,
        requiredRole: tk.requiredRole,
        requiresDeliverable: tk.requiresDeliverable,
        requiresOnsite: tk.requiresOnsite,
        requiresTwoStepReview: tk.requiresTwoStepReview,
        isRecurring: tk.isRecurring,
        recurrenceUnit: tk.recurrenceUnit,
        recurrenceInterval: tk.recurrenceInterval,
        estimateDays: tk.estimateDays
      }))
    }))
  };
}

// =====================================================
// 更新模板元数据(name / description / isActive)
// =====================================================
export async function updateTemplate(
  user: SessionUser,
  id: string,
  input: { name?: string; description?: string | null; isActive?: boolean }
) {
  requirePermission(user.roleCode, RESOURCE.WORKFLOW_TEMPLATE, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const t = await tx.workflowTemplate.findFirst({ where: { id, deletedAt: null } });
    if (!t) throw new ApiError(ERROR_CODES.NOT_FOUND, "模板不存在", 404);
    const data: Prisma.WorkflowTemplateUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const updated = await tx.workflowTemplate.update({ where: { id }, data });
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TEMPLATE_UPDATE",
      entity: "WorkflowTemplate",
      entityId: id,
      before: { name: t.name, description: t.description, isActive: t.isActive },
      after: { name: updated.name, description: updated.description, isActive: updated.isActive }
    });
    return updated;
  });
}

// =====================================================
// 任务 CRUD
// =====================================================
export type TaskInput = {
  stageId: string;
  code: string;
  name: string;
  description?: string | null;
  sort: number;
  requiredRole?: string | null;
  requiresDeliverable?: boolean;
  requiresOnsite?: boolean;
  requiresTwoStepReview?: boolean;
  isRecurring?: boolean;
  recurrenceUnit?: string | null;
  recurrenceInterval?: number | null;
  estimateDays?: number | null;
};

export async function addTask(user: SessionUser, templateId: string, input: TaskInput) {
  requirePermission(user.roleCode, RESOURCE.WORKFLOW_TEMPLATE, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const stage = await tx.workflowStage.findFirst({
      where: { id: input.stageId, templateId } as Prisma.WorkflowStageWhereInput
    });
    if (!stage) throw new ApiError(ERROR_CODES.NOT_FOUND, "阶段不存在", 404);
    // code 唯一性(同 template 下)
    const dup = await tx.workflowTask.findFirst({
      where: { code: input.code, stageId: input.stageId } as Prisma.WorkflowTaskWhereInput
    });
    if (dup) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `任务编码 ${input.code} 在该阶段下已存在`, 422);
    // 循环参数互校
    if (input.isRecurring) {
      if (!input.recurrenceUnit || !input.recurrenceInterval) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "循环任务必须指定 recurrenceUnit + recurrenceInterval", 400);
      }
      if (!WORKFLOW_RECURRENCE_UNIT.includes(input.recurrenceUnit as never)) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "recurrenceUnit 必须是 DAY/WEEK/MONTH/YEAR", 400);
      }
    }
    const created = await tx.workflowTask.create({
      data: {
        stageId: input.stageId,
        code: input.code,
        name: input.name,
        sort: input.sort,
        description: input.description ?? null,
        requiredRole: input.requiredRole ?? null,
        requiresDeliverable: input.requiresDeliverable ?? false,
        requiresOnsite: input.requiresOnsite ?? false,
        requiresTwoStepReview: input.requiresTwoStepReview ?? false,
        isRecurring: input.isRecurring ?? false,
        recurrenceUnit: input.recurrenceUnit ?? null,
        recurrenceInterval: input.recurrenceInterval ?? null,
        estimateDays: input.estimateDays ?? null
      }
    });
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TEMPLATE_TASK_ADD",
      entity: "WorkflowTask",
      entityId: created.id,
      after: { templateId, stageId: input.stageId, code: input.code, name: input.name }
    });
    return created;
  });
}

export async function updateTask(
  user: SessionUser,
  taskId: string,
  input: Partial<Omit<TaskInput, "stageId" | "code">> & { code?: string }
) {
  requirePermission(user.roleCode, RESOURCE.WORKFLOW_TEMPLATE, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const t = await tx.workflowTask.findFirst({ where: { id: taskId } });
    if (!t) throw new ApiError(ERROR_CODES.NOT_FOUND, "任务不存在", 404);
    // code 重命名时查重
    if (input.code && input.code !== t.code) {
      const dup = await tx.workflowTask.findFirst({ where: { code: input.code, stageId: t.stageId, id: { not: taskId } } });
      if (dup) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `任务编码 ${input.code} 在该阶段下已存在`, 422);
    }
    const data: Prisma.WorkflowTaskUpdateInput = {};
    if (input.code !== undefined) data.code = input.code;
    if (input.name !== undefined) data.name = input.name;
    if (input.sort !== undefined) data.sort = input.sort;
    if (input.description !== undefined) data.description = input.description;
    if (input.requiredRole !== undefined) data.requiredRole = input.requiredRole;
    if (input.requiresDeliverable !== undefined) data.requiresDeliverable = input.requiresDeliverable;
    if (input.requiresOnsite !== undefined) data.requiresOnsite = input.requiresOnsite;
    if (input.requiresTwoStepReview !== undefined) data.requiresTwoStepReview = input.requiresTwoStepReview;
    if (input.isRecurring !== undefined) data.isRecurring = input.isRecurring;
    if (input.recurrenceUnit !== undefined) data.recurrenceUnit = input.recurrenceUnit;
    if (input.recurrenceInterval !== undefined) data.recurrenceInterval = input.recurrenceInterval;
    if (input.estimateDays !== undefined) data.estimateDays = input.estimateDays;
    const updated = await tx.workflowTask.update({ where: { id: taskId }, data });
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TEMPLATE_TASK_UPDATE",
      entity: "WorkflowTask",
      entityId: taskId,
      before: { name: t.name, code: t.code, estimateDays: t.estimateDays },
      after: { name: updated.name, code: updated.code, estimateDays: updated.estimateDays }
    });
    return updated;
  });
}

export async function deleteTask(user: SessionUser, taskId: string) {
  requirePermission(user.roleCode, RESOURCE.WORKFLOW_TEMPLATE, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const t = await tx.workflowTask.findFirst({ where: { id: taskId } });
    if (!t) throw new ApiError(ERROR_CODES.NOT_FOUND, "任务不存在", 404);
    // 安全:有实例引用时禁止硬删
    const instCount = await tx.workflowTaskInstance.count({ where: { taskId, deletedAt: null } });
    if (instCount > 0) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `该任务已有 ${instCount} 个运行实例,无法删除。请新建模板版本或迁移实例。`,
        409
      );
    }
    await tx.workflowTask.delete({ where: { id: taskId } });
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TEMPLATE_TASK_DELETE",
      entity: "WorkflowTask",
      entityId: taskId,
      before: { code: t.code, name: t.name, stageId: t.stageId }
    });
    return { id: taskId };
  });
}

// =====================================================
// 克隆为新版本(老的自动 isActive=false)
// =====================================================
export async function cloneAsNewVersion(user: SessionUser, sourceId: string) {
  requirePermission(user.roleCode, RESOURCE.WORKFLOW_TEMPLATE, ACTION.CREATE);
  return prisma.$transaction(async (tx) => {
    const src = await tx.workflowTemplate.findFirst({
      where: { id: sourceId, deletedAt: null },
      include: { stages: { include: { tasks: { orderBy: { sort: "asc" } } } } }
    });
    if (!src) throw new ApiError(ERROR_CODES.NOT_FOUND, "源模板不存在", 404);
    // 找当前最大 version
    const maxVer = await tx.workflowTemplate.aggregate({
      where: { serviceType: src.serviceType, deletedAt: null },
      _max: { version: true }
    });
    const newVer = (maxVer._max.version ?? 0) + 1;
    // 关掉所有同 serviceType 的 active 模板
    await tx.workflowTemplate.updateMany({
      where: { serviceType: src.serviceType, isActive: true, deletedAt: null },
      data: { isActive: false }
    });
    // 新建
    const newTpl = await tx.workflowTemplate.create({
      data: {
        serviceType: src.serviceType,
        name: src.name,
        description: src.description,
        version: newVer,
        isActive: true,
        createdById: user.id
      }
    });
    for (let si = 0; si < src.stages.length; si++) {
      const s = src.stages[si]!;
      const newStage = await tx.workflowStage.create({
        data: {
          templateId: newTpl.id,
          phase: s.phase,
          code: s.code,
          name: s.name,
          sort: si,
          description: s.description,
          isRequired: s.isRequired
        }
      });
      for (const tk of s.tasks) {
        await tx.workflowTask.create({
          data: {
            stageId: newStage.id,
            code: tk.code,
            name: tk.name,
            sort: tk.sort,
            description: tk.description,
            requiredRole: tk.requiredRole,
            requiresDeliverable: tk.requiresDeliverable,
            requiresOnsite: tk.requiresOnsite,
            requiresTwoStepReview: tk.requiresTwoStepReview,
            isRecurring: tk.isRecurring,
            recurrenceUnit: tk.recurrenceUnit,
            recurrenceInterval: tk.recurrenceInterval,
            estimateDays: tk.estimateDays
          }
        });
      }
    }
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TEMPLATE_CLONE",
      entity: "WorkflowTemplate",
      entityId: newTpl.id,
      before: { sourceId, sourceVersion: src.version, serviceType: src.serviceType },
      after: { newVersion: newVer, id: newTpl.id }
    });
    return newTpl;
  });
}

// =====================================================
// P5: 任务实例迁移(让旧任务可被删)
// admin 专用:把 fromTask 下的所有 instance 迁到 toTask
// 约束:必须在同一模板下
// =====================================================
export async function migrateTaskInstances(
  user: SessionUser,
  fromTaskId: string,
  toTaskId: string
): Promise<{ migratedInstances: number; migratedProjects: number }> {
  requirePermission(user.roleCode, RESOURCE.WORKFLOW_TEMPLATE, ACTION.UPDATE);
  if (fromTaskId === toTaskId) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "源任务和目标任务不能相同", 400);
  }
  return prisma.$transaction(async (tx) => {
    const from = await tx.workflowTask.findFirst({
      where: { id: fromTaskId },
      include: { stage: { include: { template: true } } }
    });
    const to = await tx.workflowTask.findFirst({
      where: { id: toTaskId },
      include: { stage: { include: { template: true } } }
    });
    if (!from || !to) throw new ApiError(ERROR_CODES.NOT_FOUND, "任务不存在", 404);
    if (from.stage.templateId !== to.stage.templateId) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        "源任务和目标任务必须属于同一模板(同一 serviceType + 同一版本)",
        422
      );
    }
    // 找所有 from 任务的实例,改 taskId
    const instances = await tx.workflowTaskInstance.findMany({
      where: { taskId: fromTaskId, deletedAt: null },
      select: { id: true, projectId: true }
    });
    if (instances.length === 0) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "源任务无运行实例,无需迁移", 400);
    }
    // 校验冲突:同一 projectId + toTaskId 已有实例则跳过
    const conflicts = await tx.workflowTaskInstance.findMany({
      where: { taskId: toTaskId, projectId: { in: Array.from(new Set(instances.map((i) => i.projectId))) }, deletedAt: null },
      select: { projectId: true }
    });
    const conflictSet = new Set(conflicts.map((c) => c.projectId));
    const safe = instances.filter((i) => !conflictSet.has(i.projectId));
    if (safe.length === 0) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        "所有项目都已经存在目标任务的实例,无法迁移",
        409
      );
    }
    // 改 taskId
    const ids = safe.map((i) => i.id);
    const r = await tx.workflowTaskInstance.updateMany({
      where: { id: { in: ids } },
      data: { taskId: toTaskId }
    });
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TEMPLATE_TASK_MIGRATE",
      entity: "WorkflowTask",
      entityId: fromTaskId,
      before: { fromTaskCode: from.code, fromTaskName: from.name, instanceCount: instances.length },
      after: { toTaskCode: to.code, toTaskName: to.name, migrated: r.count, conflicts: conflictSet.size }
    });
    return {
      migratedInstances: r.count,
      migratedProjects: new Set(safe.map((i) => i.projectId)).size
    };
  });
}

// =====================================================
// P6: 阶段 CRUD
// =====================================================
import { WORKFLOW_PHASE_ORDER } from "@/types/enums";

export type StageInput = {
  phase: string;
  code: string;
  name: string;
  sort: number;
  description?: string | null;
  isRequired?: boolean;
};

export async function addStage(user: SessionUser, templateId: string, input: StageInput) {
  requirePermission(user.roleCode, RESOURCE.WORKFLOW_TEMPLATE, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const tpl = await tx.workflowTemplate.findFirst({ where: { id: templateId, deletedAt: null } });
    if (!tpl) throw new ApiError(ERROR_CODES.NOT_FOUND, "模板不存在", 404);
    if (!WORKFLOW_PHASE_ORDER.includes(input.phase as never)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `phase 必须是 ${WORKFLOW_PHASE_ORDER.join("/")}`, 400);
    }
    const dup = await tx.workflowStage.findFirst({
      where: { templateId, code: input.code } as Prisma.WorkflowStageWhereInput
    });
    if (dup) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `阶段编码 ${input.code} 在该模板下已存在`, 422);
    // sort 处理:同 phase 内插到指定位置,后续阶段 sort 顺延
    const samePhase = await tx.workflowStage.findMany({
      where: { templateId, phase: input.phase },
      orderBy: { sort: "asc" }
    });
    const insertIdx = Math.max(0, Math.min(input.sort, samePhase.length));
    // 把 >= insertIdx 的同 phase 阶段 sort+1(本 phase 内重排)
    for (let i = insertIdx; i < samePhase.length; i++) {
      await tx.workflowStage.update({ where: { id: samePhase[i]!.id }, data: { sort: i + 1 } });
    }
    const created = await tx.workflowStage.create({
      data: {
        templateId,
        phase: input.phase,
        code: input.code,
        name: input.name,
        sort: insertIdx,
        description: input.description ?? null,
        isRequired: input.isRequired ?? true
      }
    });
    // 后续 phase 的阶段 sort 也顺移(保持全局顺序)
    // 简化:不处理跨 phase 移位,只在本 phase 内重排
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TEMPLATE_STAGE_ADD",
      entity: "WorkflowStage",
      entityId: created.id,
      after: { templateId, phase: input.phase, code: input.code, name: input.name }
    });
    return created;
  });
}

export async function updateStage(
  user: SessionUser,
  stageId: string,
  input: Partial<Omit<StageInput, "phase">> & { code?: string; name?: string; sort?: number; description?: string | null; isRequired?: boolean }
) {
  requirePermission(user.roleCode, RESOURCE.WORKFLOW_TEMPLATE, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const s = await tx.workflowStage.findFirst({ where: { id: stageId } });
    if (!s) throw new ApiError(ERROR_CODES.NOT_FOUND, "阶段不存在", 404);
    if (input.code && input.code !== s.code) {
      const dup = await tx.workflowStage.findFirst({
        where: { templateId: s.templateId, code: input.code, id: { not: stageId } }
      });
      if (dup) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `阶段编码 ${input.code} 在该模板下已存在`, 422);
    }
    const data: Prisma.WorkflowStageUpdateInput = {};
    if (input.code !== undefined) data.code = input.code;
    if (input.name !== undefined) data.name = input.name;
    if (input.description !== undefined) data.description = input.description;
    if (input.isRequired !== undefined) data.isRequired = input.isRequired;
    if (input.sort !== undefined && input.sort !== s.sort) {
      // 重排:同 phase 内
      const samePhase = await tx.workflowStage.findMany({
        where: { templateId: s.templateId, phase: s.phase },
        orderBy: { sort: "asc" }
      });
      const cur = samePhase.findIndex((x) => x.id === s.id);
      if (cur >= 0) {
        const newIdx = Math.max(0, Math.min(input.sort, samePhase.length - 1));
        // 移除当前位置
        const arr = samePhase.filter((x) => x.id !== s.id);
        arr.splice(newIdx, 0, s);
        for (let i = 0; i < arr.length; i++) {
          await tx.workflowStage.update({ where: { id: arr[i]!.id }, data: { sort: i } });
        }
        data.sort = newIdx;
      }
    }
    const updated = await tx.workflowStage.update({ where: { id: stageId }, data });
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TEMPLATE_STAGE_UPDATE",
      entity: "WorkflowStage",
      entityId: stageId,
      before: { name: s.name, code: s.code, isRequired: s.isRequired },
      after: { name: updated.name, code: updated.code, isRequired: updated.isRequired }
    });
    return updated;
  });
}

export async function deleteStage(user: SessionUser, stageId: string) {
  requirePermission(user.roleCode, RESOURCE.WORKFLOW_TEMPLATE, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const s = await tx.workflowStage.findFirst({ where: { id: stageId } });
    if (!s) throw new ApiError(ERROR_CODES.NOT_FOUND, "阶段不存在", 404);
    const taskCount = await tx.workflowTask.count({ where: { stageId } });
    if (taskCount > 0) {
      throw new ApiError(
        ERROR_CODES.VALIDATION_FAILED,
        `该阶段有 ${taskCount} 个任务,请先删除/迁移任务`,
        409
      );
    }
    await tx.workflowStage.delete({ where: { id: stageId } });
    // 后续 sort 顺移
    const samePhase = await tx.workflowStage.findMany({
      where: { templateId: s.templateId, phase: s.phase, sort: { gt: s.sort } },
      orderBy: { sort: "asc" }
    });
    for (let i = 0; i < samePhase.length; i++) {
      await tx.workflowStage.update({ where: { id: samePhase[i]!.id }, data: { sort: s.sort + i } });
    }
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TEMPLATE_STAGE_DELETE",
      entity: "WorkflowStage",
      entityId: stageId,
      before: { code: s.code, name: s.name, phase: s.phase }
    });
    return { id: stageId };
  });
}

// =====================================================
// P6: 模板导入 / 导出(JSON)
// =====================================================
export type ExportedTemplate = {
  schemaVersion: 1;
  serviceType: string;
  name: string;
  description?: string | null;
  isActive?: boolean;
  stages: Array<{
    phase: string;
    code: string;
    name: string;
    sort: number;
    description?: string | null;
    isRequired?: boolean;
    tasks: Array<{
      code: string;
      name: string;
      sort: number;
      description?: string | null;
      requiredRole?: string | null;
      requiresDeliverable?: boolean;
      requiresOnsite?: boolean;
      requiresTwoStepReview?: boolean;
      isRecurring?: boolean;
      recurrenceUnit?: string | null;
      recurrenceInterval?: number | null;
      estimateDays?: number | null;
    }>;
  }>;
};

export async function exportTemplate(user: SessionUser, id: string): Promise<ExportedTemplate> {
  requirePermission(user.roleCode, RESOURCE.WORKFLOW_TEMPLATE, ACTION.READ);
  const tpl = await prisma.workflowTemplate.findFirst({
    where: { id, deletedAt: null },
    include: { stages: { orderBy: { sort: "asc" }, include: { tasks: { orderBy: { sort: "asc" } } } } }
  });
  if (!tpl) throw new ApiError(ERROR_CODES.NOT_FOUND, "模板不存在", 404);
  return {
    schemaVersion: 1,
    serviceType: tpl.serviceType,
    name: tpl.name,
    description: tpl.description,
    isActive: tpl.isActive,
    stages: tpl.stages.map((s) => ({
      phase: s.phase,
      code: s.code,
      name: s.name,
      sort: s.sort,
      description: s.description,
      isRequired: s.isRequired,
      tasks: s.tasks.map((t) => ({
        code: t.code,
        name: t.name,
        sort: t.sort,
        description: t.description,
        requiredRole: t.requiredRole,
        requiresDeliverable: t.requiresDeliverable,
        requiresOnsite: t.requiresOnsite,
        requiresTwoStepReview: t.requiresTwoStepReview,
        isRecurring: t.isRecurring,
        recurrenceUnit: t.recurrenceUnit,
        recurrenceInterval: t.recurrenceInterval,
        estimateDays: t.estimateDays
      }))
    }))
  };
}

export async function importTemplate(
  user: SessionUser,
  input: { data: ExportedTemplate; newActive?: boolean }
): Promise<{ id: string; serviceType: string; version: number; isActive: boolean; stageCount: number; taskCount: number }> {
  requirePermission(user.roleCode, RESOURCE.WORKFLOW_TEMPLATE, ACTION.CREATE);
  if (input.data.schemaVersion !== 1) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `不支持的 schemaVersion:${input.data.schemaVersion}`, 400);
  }
  if (!input.data.serviceType || !WORKFLOW_PHASE_ORDER.includes(input.data.serviceType as never) && !/^[A-Z_]+$/.test(input.data.serviceType)) {
    throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "serviceType 不合法", 400);
  }
  for (const s of input.data.stages) {
    if (!WORKFLOW_PHASE_ORDER.includes(s.phase as never)) {
      throw new ApiError(ERROR_CODES.VALIDATION_FAILED, `stage.phase 必须属于 ${WORKFLOW_PHASE_ORDER.join("/")},收到:${s.phase}`, 400);
    }
  }
  return prisma.$transaction(async (tx) => {
    // 新建模板:version 自增,isActive 由 caller 决定(默认开)
    const maxVer = await tx.workflowTemplate.aggregate({
      where: { serviceType: input.data.serviceType, deletedAt: null },
      _max: { version: true }
    });
    const newVer = (maxVer._max.version ?? 0) + 1;
    const shouldActivate = input.newActive ?? input.data.isActive;
    if (shouldActivate) {
      await tx.workflowTemplate.updateMany({
        where: { serviceType: input.data.serviceType, isActive: true, deletedAt: null },
        data: { isActive: false }
      });
    }
    const tpl = await tx.workflowTemplate.create({
      data: {
        serviceType: input.data.serviceType,
        name: input.data.name,
        description: input.data.description,
        version: newVer,
        isActive: shouldActivate,
        createdById: user.id
      }
    });
    let stageCount = 0;
    let taskCount = 0;
    for (const s of input.data.stages) {
      const stage = await tx.workflowStage.create({
        data: {
          templateId: tpl.id,
          phase: s.phase,
          code: s.code,
          name: s.name,
          sort: s.sort,
          description: s.description,
          isRequired: s.isRequired
        }
      });
      stageCount++;
      for (const t of s.tasks) {
        await tx.workflowTask.create({
          data: {
            stageId: stage.id,
            code: t.code,
            name: t.name,
            sort: t.sort,
            description: t.description,
            requiredRole: t.requiredRole,
            requiresDeliverable: t.requiresDeliverable,
            requiresOnsite: t.requiresOnsite,
            requiresTwoStepReview: t.requiresTwoStepReview,
            isRecurring: t.isRecurring,
            recurrenceUnit: t.recurrenceUnit,
            recurrenceInterval: t.recurrenceInterval,
            estimateDays: t.estimateDays
          }
        });
        taskCount++;
      }
    }
    await audit(tx, {
      actorId: user.id,
      action: "WORKFLOW_TEMPLATE_IMPORT",
      entity: "WorkflowTemplate",
      entityId: tpl.id,
      after: { serviceType: tpl.serviceType, version: newVer, stageCount, taskCount, isActive: shouldActivate }
    });
    return { id: tpl.id, serviceType: tpl.serviceType, version: newVer, isActive: !!shouldActivate, stageCount, taskCount };
  });
}
