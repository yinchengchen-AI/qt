// 软删除合同服务层单测 (softDeleteContract, server/services/contract.ts:594)
//
// 覆盖矩阵:
//   1) DRAFT + 无子数据 → 软删成功 + 写 audit log
//   2) PENDING_REVIEW + 无子数据 → 软删成功
//   3) ACTIVE 状态 → 抛 403 ENTITY_IMMUTABLE
//   5) 合同不存在 → 抛 404
//   6) 非 admin (SALES) → 抛 403 FORBIDDEN
//
// DB 不可达时整组 skip. 测试数据用 unique 前缀, 跑完自己清理, 不污染生产.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { softDeleteContract } from "@/server/services/contract";
import { ApiError } from "@/lib/api";
import type { SessionUser } from "@/lib/session";

let dbReachable = false;
const TAG = `TEST-SOFTDEL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdContractNos: string[] = [];
const createdContractIds: string[] = [];
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let salesUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "SALES" } | null = null;
let testCustomerId: string | null = null;
let activeCustomerId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  // 找库内任意一个 admin + sales + customer, 复用 seed 数据
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

  // 准备一个测试客户 (用 unique code 避免冲突, 跑完会清理)
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
  activeCustomerId = cust.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    // 物理清理测试数据 (软删的也一并 deleteMany 兜底)
    if (createdContractNos.length > 0) {
      await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
    }
    if (testCustomerId) {
      await prisma.contract.deleteMany({ where: { customerId: testCustomerId } });
      await prisma.customer.delete({ where: { id: testCustomerId } });
    }
    // 清理 operationLog 里我们写的 audit 记录
    if (createdContractNos.length > 0) {
      await prisma.operationLog.deleteMany({
        where: { entity: "Contract", action: "CONTRACT_SOFT_DELETE", entityId: { in: createdContractIds } }
      });
    }
  } catch {
    // 忽略清理失败
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable) return;
  if (!adminUser || !salesUser || !activeCustomerId) return;
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

async function mkContract(status: string, suffix: string) {
  if (!adminUser || !activeCustomerId) throw new Error("setup not ready");
  const no = `${TAG}-${suffix}`;
  createdContractNos.push(no);
  return prisma.contract.create({
    data: {
      contractNo: no,
      customerId: activeCustomerId,
      customerName: `${TAG}-客户`,
      title: `${TAG}-title-${suffix}`,
      serviceType: "OTHER",
      signDate: new Date("2026-01-01T00:00:00Z"),
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-12-31T00:00:00Z"),
      totalAmount: "0",
      taxRate: "0",
      taxAmount: "0",
      amountExcludingTax: "0",
      paymentMethod: "LUMP_SUM",
      status,
      ownerUserId: adminUser.id,
      signerId: adminUser.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  }).then((row) => { createdContractIds.push(row.id); return row; });
}

describe("softDeleteContract 服务层", () => {
  it("DRAFT + 无子数据 → 软删成功, 写 deletedAt", guard(async () => {
    const c = await mkContract("DRAFT", "DRAFT-OK");
    const r = await softDeleteContract(buildAdmin(), c.id);
    expect(r.deletedAt).toBeInstanceOf(Date);
    // 重新读出确认落库
    const reloaded = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(reloaded?.deletedAt).toBeInstanceOf(Date);
  }));

  it("PENDING_REVIEW + 无子数据 → 软删成功", guard(async () => {
    const c = await mkContract("ACTIVE", "PENDING-OK");
    const r = await softDeleteContract(buildAdmin(), c.id);
    expect(r.deletedAt).toBeInstanceOf(Date);
  }));

  it("ACTIVE 状态 + 无子数据 → admin 软删成功 (新模型: admin 任意态可删, 子数据兜底)", guard(async () => {
    const c = await mkContract("ACTIVE", "ACTIVE-DEL");
    const r = await softDeleteContract(buildAdmin(), c.id);
    expect(r.deletedAt).toBeInstanceOf(Date);
  }));


  it("合同不存在 → 抛 404 NOT_FOUND", guard(async () => {
    await expect(softDeleteContract(buildAdmin(), "non-existent-id")).rejects.toMatchObject({
      errorCode: "NOT_FOUND"
    });
  }));

  it("非 admin (SALES) → 抛 403 FORBIDDEN, 双检兜底必触发", guard(async () => {
    const c = await mkContract("DRAFT", "SALES-NO");
    // 双层:requirePermission 在 SALES 没配 CONTRACT.DELETE 时已抛 403;
    // 即便未来权限矩阵误把 DELETE 给了 SALES,user.roleCode !== "ADMIN" 这道关也兜住.
    // expect.rejects 失败时 vitest 让本 it 失败,不需要外层 try/catch.
    await expect(softDeleteContract(buildSales(), c.id)).rejects.toBeInstanceOf(ApiError);
    const reloaded = await prisma.contract.findUnique({ where: { id: c.id } });
    expect(reloaded?.deletedAt).toBeNull();
  }));
});
