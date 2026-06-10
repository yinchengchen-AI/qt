import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { type SessionUser } from "@/lib/session";
import { nextBusinessNo } from "@/lib/sequence";
import { audit } from "@/server/audit";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { ProjectCreateInput, ProjectUpdateInput, ProjectActionInput } from "@/lib/validators/project";
import type { Prisma } from "@prisma/client";

export async function listProjects(
  user: SessionUser,
  params: { page: number; pageSize: number; keyword?: string; status?: string; contractId?: string }
) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);
  const { page, pageSize, keyword, status, contractId } = params;
  const where: Prisma.ProjectWhereInput = {
    deletedAt: null,
    ...(status ? { status } : {}),
    ...(contractId ? { contractId } : {}),
    ...(keyword
      ? { OR: [{ name: { contains: keyword, mode: "insensitive" } }, { projectNo: { contains: keyword, mode: "insensitive" } }] }
      : {}),
    // 行级隔离：通过 contract 关系
    ...(user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {})
  };
  const [list, total] = await Promise.all([
    prisma.project.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize, include: { contract: { select: { contractNo: true, title: true, ownerUserId: true, totalAmount: true } } } }),
    prisma.project.count({ where })
  ]);
  return { list, total, page, pageSize };
}

export async function getProject(user: SessionUser, id: string) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.READ);
  const p = await prisma.project.findFirst({
    where: { id, deletedAt: null, ...(user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {}) },
    include: { contract: true, progressLogs: { orderBy: { at: "desc" }, take: 20 } }
  });
  if (!p) throw new ApiError(ERROR_CODES.NOT_FOUND, "项目不存在", 404);
  return p;
}

export async function createProject(user: SessionUser, input: ProjectCreateInput) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.CREATE);
  return prisma.$transaction(async (tx) => {
    const contract = await tx.contract.findFirst({ where: { id: input.contractId, deletedAt: null, ...(user.roleCode === "SALES" ? { ownerUserId: user.id } : {}) } });
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
    return tx.project.create({
      data: {
        projectNo,
        contractId: input.contractId,
        name: input.name,
        serviceScope: input.serviceScope,
        managerUserId: input.managerUserId ?? user.id,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        budgetAmount: input.budgetAmount ?? null,
        status: "PLANNED",
        createdById: user.id,
        updatedById: user.id
      }
    });
  });
}

export async function updateProject(user: SessionUser, id: string, input: ProjectUpdateInput) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);
  const p = await prisma.project.findFirst({
    where: { id, deletedAt: null, ...(user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {}) }
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
      budgetAmount: input.budgetAmount ?? undefined,
      updatedById: user.id
    }
  });
}

// 状态机：start / suspend / resume / deliver / accept / close / cancel / progress
export async function projectAction(user: SessionUser, id: string, input: ProjectActionInput) {
  requirePermission(user.roleCode, RESOURCE.PROJECT, ACTION.UPDATE);
  return prisma.$transaction(async (tx) => {
    const p = await tx.project.findFirst({
      where: { id, deletedAt: null, ...(user.roleCode === "SALES" ? { contract: { ownerUserId: user.id } } : {}) }
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
    if (input.action === "progress") {
      if (typeof input.percent !== "number") throw new ApiError(ERROR_CODES.VALIDATION_FAILED, "请填写 percent", 400);
      await tx.projectProgressLog.create({
        data: { projectId: id, userId: user.id, percent: input.percent, remark: input.remark ?? "" }
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
    return updated;
  });
}
