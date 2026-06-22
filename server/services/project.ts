import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { nextBusinessNo } from "@/lib/sequence";
import { instantiateProjectWorkflow } from "./workflow";
import { tryAutoExecuteContract, tryAutoCompleteContract } from "./contract";
import { audit } from "@/server/audit";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { ProjectCreateInput, ProjectUpdateInput, ProjectActionInput } from "@/lib/validators/project";
import { Prisma } from "@prisma/client";
import { ownerEq, ownerViaContract, parseStatusList } from "@/lib/ownership";

// P14: 项目 360 视图 — 聚合工作流统计数据
import { WORKFLOW_PHASE_ORDER } from "@/types/enums";

export type ProjectOverview = {
  workflowStats: {
    totalTasks: number;
    completed: number;
    inProgress: number;
    pending: number;
    blocked: number;
    byPhase: Array<{ phase: string; name: string; total: number; completed: number; locked: boolean }>;
  };
};

export async function getProjectOverview(user: SessionUser, id: string): Promise<ProjectOverview> {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);
  const p = await prisma.project.findFirst({
    where: { id, deletedAt: null, ...(ownerViaContract(user) as Prisma.ProjectWhereInput) }
  });
  if (!p) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);

  const instances = await prisma.workflowTaskInstance.findMany({
    where: { projectId: id, deletedAt: null },
    include: {
      task: {
        include: { stage: { select: { phase: true, code: true } } }
      }
    }
  });

  const statusCount: Record<string, number> = { PENDING: 0, IN_PROGRESS: 0, COMPLETED: 0, BLOCKED: 0, SKIPPED: 0 };
  type PEntry = { total: number; completed: number };
  const phaseMap = new Map<string, PEntry>();

  for (const inst of instances) {
    statusCount[inst.status] = (statusCount[inst.status] ?? 0) + 1;
    const phase = inst.task.stage.phase;
    if (!phaseMap.has(phase)) phaseMap.set(phase, { total: 0, completed: 0 });
    const entry = phaseMap.get(phase)!;
    entry.total++;
    if (inst.status === "COMPLETED" || inst.status === "SKIPPED") entry.completed++;
  }

  const PHASE_NAME: Record<string, string> = {
    PREP: "前期准备", REQUIREMENT: "需求确认", CONTRACT: "合同签订", EXECUTE: "执行交付", FOLLOWUP: "后续跟进"
  };
  const byPhase: ProjectOverview["workflowStats"]["byPhase"] = WORKFLOW_PHASE_ORDER.map((phase) => {
    const entry = phaseMap.get(phase) ?? { total: 0, completed: 0 };
    const prevIdx = WORKFLOW_PHASE_ORDER.indexOf(phase) - 1;
    let locked = false;
    if (prevIdx >= 0) {
      const prevPhase = WORKFLOW_PHASE_ORDER[prevIdx];
      const prev = prevPhase ? phaseMap.get(prevPhase) : undefined;
      locked = !prev || prev.completed < prev.total;
    }
    return {
      phase,
      name: PHASE_NAME[phase] ?? phase,
      total: entry.total,
      completed: entry.completed,
      locked
    };
  });

  return {
    workflowStats: {
      totalTasks: instances.length,
      completed: (statusCount.COMPLETED ?? 0) + (statusCount.SKIPPED ?? 0),
      inProgress: statusCount.IN_PROGRESS ?? 0,
      pending: statusCount.PENDING ?? 0,
      blocked: statusCount.BLOCKED ?? 0,
      byPhase
    }
  };
}

/**
 * 从工作流任务实例派生项目完成度(读时计算,不落库)
 * = COMPLETED / (total - SKIPPED) * 100,保留 1 位小数
 * 无任务时返回 0;所有任务都 SKIPPED 时也按 0 处理
 */
export function computeProgressPct(instances: Array<{ status: string }>): number {
  const total = instances.length;
  if (total === 0) return 0;
  const skipped = instances.filter((i) => i.status === "SKIPPED").length;
  const denom = Math.max(1, total - skipped);
  const done = instances.filter((i) => i.status === "COMPLETED").length;
  return Math.round((done / denom) * 1000) / 10;
}

export async function listProjects(
  user: SessionUser,
  params: { page: number; pageSize: number; keyword?: string; status?: string; contractId?: string }
) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);
  const { page, pageSize, keyword, status, contractId } = params;
  const statusList = parseStatusList(status);
  const where: Prisma.ProjectWhereInput = {
    deletedAt: null,
    ...(statusList ? { status: { in: statusList } } : {}),
    ...(contractId ? { contractId } : {}),
    ...(keyword
      ? { OR: [{ name: { contains: keyword, mode: "insensitive" } }, { projectNo: { contains: keyword, mode: "insensitive" } }] }
      : {}),
    // 行级隔离：通过 contract 关系
    ...(ownerViaContract(user) as Prisma.ProjectWhereInput),
  };
  const [list, total] = await Promise.all([
    prisma.project.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { contract: { select: { contractNo: true, title: true, ownerUserId: true, totalAmount: true } } } }),
    prisma.project.count({ where })
  ]);
  // 批量加载这些项目的工作流任务实例,按 projectId 分组后计算 progressPct(避免 N+1)
  const ids = list.map((p) => p.id);
  const instances = ids.length > 0
    ? await prisma.workflowTaskInstance.findMany({
        where: { projectId: { in: ids }, deletedAt: null },
        select: { projectId: true, status: true }
      })
    : [];
  const byProject = new Map<string, Array<{ status: string }>>();
  for (const ins of instances) {
    const arr = byProject.get(ins.projectId) ?? [];
    arr.push({ status: ins.status });
    byProject.set(ins.projectId, arr);
  }
  const listWithProgress = list.map((p) => ({
    ...p,
    progressPct: computeProgressPct(byProject.get(p.id) ?? [])
  }));
  return { list: listWithProgress, total, page, pageSize };
}

export async function getProject(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);
  const p = await prisma.project.findFirst({
    where: { id, deletedAt: null, ...(ownerViaContract(user) as Prisma.ProjectWhereInput) },
    include: { contract: true, progressLogs: { orderBy: { at: "desc" }, take: 20 } }
  });
  if (!p) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);
  const instances = await prisma.workflowTaskInstance.findMany({
    where: { projectId: id, deletedAt: null },
    select: { status: true }
  });
  return { ...p, progressPct: computeProgressPct(instances) };
}

export async function updateProject(user: SessionUser, id: string, input: ProjectUpdateInput) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);
  const p = await prisma.project.findFirst({
    where: { id, deletedAt: null, ...(ownerViaContract(user) as Prisma.ProjectWhereInput) }
  });
  if (!p) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);
  if (p.status !== "PLANNED" && p.status !== "SUSPENDED") {
    throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, "当前状态不可编辑", 403);
  }
  if (input.endDate) {
    const c = await prisma.contract.findUniqueOrThrow({ where: { id: p.contractId } });
    if (new Date(input.endDate) > new Date(c.endDate)) {
      throw new ApiError(ERROR_CODES.PROJECT_DATE_OUT_OF_RANGE, "项目结束日期不能晚于合同结束日期", 422);
    }
  }
  return prisma.project.update({
    where: { id },
    data: {
      ...input,
      startDate: input.startDate ? new Date(input.startDate) : undefined,
      endDate: input.endDate ? new Date(input.endDate) : undefined,
      updatedById: user.id
    }
  });
}

// 状态机：start / suspend / resume / deliver / accept / close / cancel / progress
export async function projectAction(user: SessionUser, id: string, input: ProjectActionInput) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const p = await tx.project.findFirst({
      where: { id, deletedAt: null, ...(ownerViaContract(user) as Prisma.ProjectWhereInput) }
    });
    if (!p) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);
    const transitions: Record<string, { from: string[]; to: string }> = {
      start: { from: ["PLANNED"], to: "IN_PROGRESS" },
      suspend: { from: ["IN_PROGRESS"], to: "SUSPENDED" },
      resume: { from: ["SUSPENDED"], to: "IN_PROGRESS" },
      deliver: { from: ["IN_PROGRESS"], to: "DELIVERED" },
      accept: { from: ["DELIVERED"], to: "ACCEPTED" },
      close: { from: ["ACCEPTED"], to: "CLOSED" },
      cancel: { from: ["PLANNED", "IN_PROGRESS", "SUSPENDED"], to: "CANCELLED" }
    };
    // R-17:deliver / accept / close 三个向前推进动作,要求所有 requiresDeliverable=true 的工作流任务
    // 必须 COMPLETED 或 SKIPPED,否则拒绝并报 PROJECT_DELIVERABLES_INCOMPLETE。
    // cancel 不在此门控内:取消即停,遗留任务保留为 PENDING/IN_PROGRESS 作为历史。
    if (["deliver", "accept", "close"].includes(input.action)) {
      const pending = await tx.workflowTaskInstance.count({
        where: {
          projectId: id,
          deletedAt: null,
          status: { notIn: ["COMPLETED", "SKIPPED"] },
          task: { requiresDeliverable: true }
        }
      });
      if (pending > 0) {
        throw new ApiError(
          ERROR_CODES.PROJECT_DELIVERABLES_INCOMPLETE,
          `仍有 ${pending} 个必交付任务未完成,项目不可 ${input.action}`,
          422
        );
      }
    }
    if (input.action === "progress") {
      // 项目级里程碑记录:仅写 remark(text),不携带任何数字;
      // 数字进度自 v0.3.1 起由工作流任务完成度派生(Project.progressPct)
      const remark = (input.remark ?? "").trim();
      if (!remark) {
        throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "请填写里程碑说明", 400);
      }
      await tx.projectProgressLog.create({
        data: { projectId: id, userId: user.id, remark }
      });
      return tx.project.findUniqueOrThrow({ where: { id } });
    }
    const t = transitions[input.action];
    if (!t) throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "未知动作", 400);
    if (!t.from.includes(p.status)) {
      throw new ApiError(ERROR_CODES.ENTITY_IMMUTABLE, `当前状态 ${p.status} 不允许 ${input.action}`, 403);
    }
    const before = { status: p.status };
    const updated = await tx.project.update({ where: { id }, data: { status: t.to, updatedById: user.id } });
    await audit(tx, { actorId: user.id, action: `PROJECT_${input.action.toUpperCase()}`, entity: "Project", entityId: id, before, after: { status: t.to } });
    // 合同状态机自动转换: start 触发 EFFECTIVE->EXECUTING; close/cancel 触发自动结清.
    // 静默可重入: tryAuto* 内部状态不匹配会 no-op, 不抛错拖垮主事务.
    if (input.action === "start") {
      await tryAutoExecuteContract(tx, p.contractId, { projectId: id, projectName: p.name });
    } else if (input.action === "close" || input.action === "cancel") {
      await tryAutoCompleteContract(tx, p.contractId);
    }
    return updated;
  });
}
export async function createProject(user: SessionUser, input: ProjectCreateInput) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.CREATE);
  return prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findFirst({ where: { id: input.contractId, deletedAt: null, ...ownerEq(user) } });
    if (!contract) throw new ApiError(ERROR_CODES.NOT_FOUND, "合同不存在", 404);
    // R-05
    if (contract.status !== "EFFECTIVE" && contract.status !== "EXECUTING") {
      throw new ApiError(ERROR_CODES.PROJECT_CONTRACT_NOT_EFFECTIVE, "项目必须挂在 EFFECTIVE/EXECUTING 状态的合同下", 422);
    }
    // R-06
    if (new Date(input.endDate) > new Date(contract.endDate)) {
      throw new ApiError(ERROR_CODES.PROJECT_DATE_OUT_OF_RANGE, "项目结束日期不能晚于合同结束日期", 422);
    }
    const projectNo = await nextBusinessNo("PROJECT");
    const project = await tx.project.create({
      data: {
        projectNo,
        contractId: input.contractId,
        name: input.name,
        serviceScope: input.serviceScope,
        managerUserId: input.managerUserId ?? user.id,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        status: "PLANNED",
        createdById: user.id,
        updatedById: user.id
      }
    });
    // P1: 创建项目后自动实例化工作流;缺少模板时不阻塞,其它错误随事务回滚
    try {
      await instantiateProjectWorkflow(user, project.id, { tx });
    } catch (e) {
      if (e instanceof ApiError && e.errorCode === ERROR_CODES.WORKFLOW_TEMPLATE_NOT_FOUND) {
        console.warn(`[workflow] project ${project.id} skipped auto-init:`, e.message);
      } else {
        throw e;
      }
    }
    return project;
  });
}

// =====================================================
// P2: 项目软删除 (admin only, 走 deletedAt)
// =====================================================
//
// 设计要点 (跟 softDeleteContract 一致):
//   1) requirePermission 只给 ADMIN 配了 PROJECT.DELETE, 这里再显式双检 user.roleCode === "ADMIN"
//      防止以后误改 ROLE_PERMISSIONS 表而悄悄放权. 合同软删 admin-only 是高敏操作, 同样的双检
//      模式搬到项目上, 避免有人通过权限矩阵把 SALES 也加上 DELETE 后悄悄能删别人的项目.
//   2) 状态机门控: 只允许 PLANNED / CANCELLED. PLANNED 是"还没动"的项目, 通常是录错或计划变更;
//      CANCELLED 是终态, 内部历史不再需要可以清掉. IN_PROGRESS / SUSPENDED / DELIVERED /
//      ACCEPTED / CLOSED 都不行, 避免误删还在用或财务已结清的项目.
//   3) 级联软删: 项目下的 WorkflowTaskInstance + ProjectProgressLog 全部打 deletedAt.
//      后续如果从回收站恢复, 也要级联 un-delete (但本 PR 不做, 后续若需要再加).
//   4) 用 Serializable 事务 + P2034 重试, 防止并发场景: T1 校验"无子任务"时 T2 突然
//      插了任务, T1 在 read committed 下把无子任务的项目软删掉, 违反不变量.
//
const SERIALIZABLE_RETRY_PROJECT = 3;

export async function softDeleteProject(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.DELETE);
  // 双检兜底: 项目软删是 admin-only 高敏操作, 跟合同软删同款防御
  if (user.roleCode !== "ADMIN") {
    throw new ApiError(ERROR_CODES.FORBIDDEN, "仅管理员可删除项目", 403);
  }

  for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_PROJECT; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.project.findFirst({ where: { id, deletedAt: null } });
          if (!existing) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);
          if (!["PLANNED", "CANCELLED"].includes(existing.status)) {
            throw new ApiError(
              ERROR_CODES.ENTITY_IMMUTABLE,
              `当前状态 ${existing.status} 不可删除（须 PLANNED / CANCELLED）`,
              403
            );
          }
          // 级联软删子表: workflowTaskInstance + projectProgressLog.
          // 同事务一起做, 避免半删 (项目没了但子任务还活着, 后续列表/统计会出脏数据).
          const [taskResult, logResult] = await Promise.all([
            tx.workflowTaskInstance.updateMany({
              where: { projectId: id, deletedAt: null },
              data: { deletedAt: new Date() }
            }),
            tx.projectProgressLog.updateMany({
              where: { projectId: id, deletedAt: null },
              data: { deletedAt: new Date() }
            })
          ]);
          const before = { status: existing.status, projectNo: existing.projectNo };
          const r = await tx.project.update({
            where: { id },
            data: { deletedAt: new Date(), updatedById: user.id }
          });
          await audit(tx, {
            actorId: user.id,
            action: "PROJECT_SOFT_DELETE",
            entity: "Project",
            entityId: id,
            before,
            after: {
              deleted: true,
              cascadedTaskInstances: taskResult.count,
              cascadedProgressLogs: logResult.count
            }
          });
          return r;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === "P2034" &&
        attempt < SERIALIZABLE_RETRY_PROJECT
      ) {
        continue;
      }
      throw e;
    }
  }
  // 不可达: 内层 catch 已 throw e
  throw new Error("unreachable: SERIALIZABLE_RETRY exhausted");
}
