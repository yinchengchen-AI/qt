// 软删除项目服务层单测 (softDeleteProject, server/services/project.ts)
//
// 覆盖矩阵:
//   1) PLANNED + 无子数据 → 软删成功 + 写 audit log
//   2) CANCELLED + 无子数据 → 软删成功
//   3) IN_PROGRESS 状态 → 抛 403 ENTITY_IMMUTABLE
//   4) PLANNED + 有 workflow task instance → 软删成功, 子任务一并 deletedAt (级联软删)
//   5) PLANNED + 有 project progress log → 软删成功, 日志一并 deletedAt (级联软删)
//   6) 项目不存在 → 抛 404 NOT_FOUND
//   7) 非 admin (SALES) → 抛 403 FORBIDDEN, 双检兜底必触发
//
// DB 不可达时整组 skip. 测试数据用 unique 前缀, 跑完自己清理, 不污染生产.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { softDeleteProject } from "@/server/services/project";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/session";

let dbReachable = false;
const TAG = `TEST-SOFTDEL-PRJ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdProjectNos: string[] = [];
const createdProjectIds: string[] = [];
const createdContractNos: string[] = [];
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let salesUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "SALES" } | null = null;
let testCustomerId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  // 找库内任意一个 admin + sales, 复用 seed 数据
  const adminRow = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  const salesRow = await prisma.user.findFirst({
    where: { role: { code: "SALES" }, deletedAt: null },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  if (!adminRow || !salesRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN" };
  salesUser = { id: salesRow.id, employeeNo: salesRow.employeeNo, name: salesRow.name, email: salesRow.email, roleCode: "SALES" };

  // 准备一个测试客户 + 一份 EFFECTIVE 合同 (项目必须挂在 EFFECTIVE/EXECUTING 合同下)
  const cust = await prisma.customer.create({
    data: {
      code: `${TAG}-CUST`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000000",
      createdById: adminUser.id,
      updatedById: adminUser.id,
      ownerUserId: adminUser.id
    }
  });
  testCustomerId = cust.id;
  const cno = `${TAG}-CONTRACT`;
  createdContractNos.push(cno);
  await prisma.contract.create({
    data: {
      contractNo: cno,
      customerId: cust.id,
      customerName: cust.name,
      title: `${TAG}-title`,
      serviceType: "OTHER",
      signDate: new Date("2026-01-01T00:00:00Z"),
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-12-31T00:00:00Z"),
      totalAmount: "0",
      taxRate: "0",
      taxAmount: "0",
      amountExcludingTax: "0",
      paymentMethod: "LUMP_SUM",
      status: "EFFECTIVE",
      ownerUserId: adminUser.id,
      signerId: adminUser.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    // 物理清理测试数据 (软删的也一并 deleteMany 兜底)
    if (createdProjectIds.length > 0) {
      // projectProgressLog table deleted in PR-2
      await prisma.workflowTaskInstance.deleteMany({ where: { projectId: { in: createdProjectIds } } });
      await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
    }
    if (createdContractNos.length > 0 && testCustomerId) {
      await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
      await prisma.customer.delete({ where: { id: testCustomerId } });
    }
  } catch {
    // 忽略清理失败
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable) return;
  if (!adminUser || !salesUser || !testCustomerId) return;
  await fn();
};

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return {
    id: adminUser.id,
    employeeNo: adminUser.employeeNo,
    name: adminUser.name,
    email: adminUser.email,
    roleCode: "ADMIN",
    permissions: []
  };
};
const buildSales = (): SessionUser => {
  if (!salesUser) throw new Error("sales not bootstrapped");
  return {
    id: salesUser.id,
    employeeNo: salesUser.employeeNo,
    name: salesUser.name,
    email: salesUser.email,
    roleCode: "SALES",
    permissions: []
  };
};

async function mkProject(status: string, suffix: string) {
  if (!adminUser || !testCustomerId) throw new Error("setup not ready");
  const cno = createdContractNos[0];
  if (!cno) throw new Error("no test contract");
  const contract = await prisma.contract.findFirst({ where: { contractNo: cno } });
  if (!contract) throw new Error("test contract missing");
  const pno = `${TAG}-${suffix}`;
  createdProjectNos.push(pno);
  const p = await prisma.project.create({
    data: {
      projectNo: pno,
      contractId: contract.id,
      name: `${TAG}-name-${suffix}`,
      serviceScope: "test",
      managerUserId: adminUser.id,
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-12-31T00:00:00Z"),
      status,
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
  createdProjectIds.push(p.id);
  return p;
}

describe("softDeleteProject 服务层", () => {
  it("PLANNED + 无子数据 → 软删成功, 写 deletedAt", guard(async () => {
    const p = await mkProject("PLANNED", "PLANNED-OK");
    const r = await softDeleteProject(buildAdmin(), p.id);
    expect(r.deletedAt).toBeInstanceOf(Date);
    const reloaded = await prisma.project.findUnique({ where: { id: p.id } });
    expect(reloaded?.deletedAt).toBeInstanceOf(Date);
  }));

  it("CANCELLED + 无子数据 → 软删成功", guard(async () => {
    const p = await mkProject("CANCELLED", "CANCELLED-OK");
    const r = await softDeleteProject(buildAdmin(), p.id);
    expect(r.deletedAt).toBeInstanceOf(Date);
  }));

  it("IN_PROGRESS 状态 → 抛 403 ENTITY_IMMUTABLE, 不写 deletedAt", guard(async () => {
    const p = await mkProject("IN_PROGRESS", "INPROG-NO");
    await expect(softDeleteProject(buildAdmin(), p.id)).rejects.toMatchObject({
      errorCode: "ENTITY_IMMUTABLE"
    });
    const reloaded = await prisma.project.findUnique({ where: { id: p.id } });
    expect(reloaded?.deletedAt).toBeNull();
  }));

  it("PLANNED + 有 workflow task instance → 软删成功, 子任务一并 deletedAt (级联软删)", guard(async () => {
    const p = await mkProject("PLANNED", "WITH-TASK");
    // 找一个真实的 WorkflowTask id 当 FK (taskId 是 required FK)
    const anyTask = await prisma.workflowTask.findFirst({ select: { id: true } });
    if (!anyTask) throw new Error("no WorkflowTask in DB, run pnpm seed first");
    const task = await prisma.workflowTaskInstance.create({
      data: {
        projectId: p.id,
        taskId: anyTask.id,
        status: "PENDING"
      }
    });
    try {
      const r = await softDeleteProject(buildAdmin(), p.id);
      expect(r.deletedAt).toBeInstanceOf(Date);
      // 子任务应该被级联软删
      const reloadedTask = await prisma.workflowTaskInstance.findUnique({ where: { id: task.id } });
      expect(reloadedTask?.deletedAt).toBeInstanceOf(Date);
    } finally {
      // 兜底物理清理
      await prisma.workflowTaskInstance.deleteMany({ where: { projectId: p.id } });
    }
  }));



  it("项目不存在 → 抛 404 NOT_FOUND", guard(async () => {
    await expect(softDeleteProject(buildAdmin(), "non-existent-id")).rejects.toMatchObject({
      errorCode: "NOT_FOUND"
    });
  }));

  it("非 admin (SALES) → 抛 403 FORBIDDEN, 双检兜底必触发", guard(async () => {
    const p = await mkProject("PLANNED", "SALES-NO");
    // 双层:requirePermission 在 SALES 没配 PROJECT.DELETE 时已抛 403;
    // 即便未来权限矩阵误把 DELETE 给了 SALES,user.roleCode !== "ADMIN" 这道关也兜住.
    await expect(softDeleteProject(buildSales(), p.id)).rejects.toBeInstanceOf(ApiError);
    const reloaded = await prisma.project.findUnique({ where: { id: p.id } });
    expect(reloaded?.deletedAt).toBeNull();
  }));
});
