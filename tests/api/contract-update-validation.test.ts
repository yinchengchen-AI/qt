// PATCH /api/contracts/[id] 路由/服务层校验回归
//
// 覆盖:
//   1) 非 admin 编辑 ACTIVE 合同 → 403 ENTITY_IMMUTABLE
//   2) updateSchema 已剔除 customerId / signerId,service 层应忽略它们
//   3) 止期 <= 起期 → 400 VALIDATION_FAILED
//   4) 合同编号改重 → 422 VALIDATION_FAILED
//   5) 负责人改成 DISABLED 员工 → 400 VALIDATION_FAILED
//
// DB 不可达时整组 skip. 数据带唯一 TAG 前缀,跑完自清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import {
  createContract,
  publishContract,
  updateContract
} from "@/server/services/contract";

let dbReachable = false;
const TAG = `TEST-CONTRACT-UPD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;
let disabledUser: { id: string } | null = null;
let testCustomerId: string | null = null;
const createdContractIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const adminRow = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE" },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  const salesRow = await prisma.user.findFirst({
    where: { role: { code: "SALES" }, deletedAt: null, status: "ACTIVE" },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  if (!adminRow || !salesRow) return;
  adminUser = { ...adminRow, roleCode: "ADMIN", permissions: [] };
  salesUser = { ...salesRow, roleCode: "SALES", permissions: [] };

  // 造一个 DISABLED 员工用于负责人校验测试
  disabledUser = await prisma.user.create({
    data: {
      employeeNo: `${TAG}-DISABLED`,
      name: `${TAG}-禁用员工`,
      email: `${TAG}-disabled@example.com`,
      passwordHash: "not-valid",
      role: { connect: { code: "SALES" } },
      status: "DISABLED"
    },
    select: { id: true }
  });

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
      ownerUserId: salesUser.id
    }
  });
  testCustomerId = cust.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (createdContractIds.length > 0) {
      await prisma.contractReviewLog.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
    }
    if (testCustomerId) {
      await prisma.customer.deleteMany({ where: { id: testCustomerId } });
    }
    if (disabledUser) {
      await prisma.user.deleteMany({ where: { id: disabledUser.id } });
    }
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !salesUser || !testCustomerId) return;
  await fn();
};

async function mkContract(status: "DRAFT" | "ACTIVE", suffix: string) {
  if (!adminUser || !testCustomerId) throw new Error("setup not ready");
  const c = await createContract(adminUser, {
    customerId: testCustomerId,
    contractNo: `${TAG}-${suffix}`,
    title: `${TAG}-title-${suffix}`,
    serviceType: "OTHER",
    signDate: "2026-01-01T00:00:00.000Z",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-12-31T00:00:00.000Z",
    totalAmount: 10000,
    taxRate: 0.06,
    paymentMethod: "LUMP_SUM",
    attachments: []
  });
  if (!c) throw new Error("createContract returned null");
  createdContractIds.push(c.id);
  if (status === "ACTIVE") {
    await publishContract(adminUser, c.id);
  }
  return c;
}

describe("updateContract 服务层校验", () => {
  it("SALES 编辑 ACTIVE 合同 → 403 ENTITY_IMMUTABLE", guard(async () => {
    const c = await mkContract("ACTIVE", "SALES-EDIT");
    await expect(
      updateContract(salesUser!, c.id, { title: `${TAG}-hacked` })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.ENTITY_IMMUTABLE });
  }));

  it("customerId / signerId 被 schema 剔除,不会更换客户或签订人", guard(async () => {
    const c = await mkContract("DRAFT", "NO-PIVOT");
    const otherAdmin = await prisma.user.findFirst({
      where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE", NOT: { id: adminUser!.id } },
      select: { id: true }
    });
    const otherCustomer = await prisma.customer.create({
      data: {
        code: `${TAG}-OTHER-CUST`,
        name: `${TAG}-其他客户`,
        customerType: "ENTERPRISE",
        province: "浙江省",
        city: "杭州市",
        contactPhone: "13800000001",
        createdById: adminUser!.id,
        updatedById: adminUser!.id,
        ownerUserId: adminUser!.id
      }
    });
    try {
      const input = {
        title: `${TAG}-pivot-checked`,
        customerId: otherCustomer.id,
        signerId: otherAdmin?.id ?? adminUser!.id
      } as unknown as Parameters<typeof updateContract>[2];
      await updateContract(adminUser!, c.id, input);
      const reloaded = await prisma.contract.findUnique({ where: { id: c.id } });
      expect(reloaded?.customerId).toBe(testCustomerId);
      expect(reloaded?.signerId).toBe(c.signerId);
      expect(reloaded?.title).toBe(`${TAG}-pivot-checked`);
    } finally {
      await prisma.customer.deleteMany({ where: { id: otherCustomer.id } });
    }
  }));

  it("止期 <= 起期 → 400 VALIDATION_FAILED", guard(async () => {
    const c = await mkContract("DRAFT", "DATE-ERR");
    await expect(
      updateContract(adminUser!, c.id, {
        startDate: "2026-12-31T00:00:00.000Z",
        endDate: "2026-01-01T00:00:00.000Z"
      })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));

  it("合同编号改为已存在编号 → 422 VALIDATION_FAILED", guard(async () => {
    const c1 = await mkContract("DRAFT", "DUP-1");
    const c2 = await mkContract("DRAFT", "DUP-2");
    await expect(
      updateContract(adminUser!, c2.id, { contractNo: c1.contractNo })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));

  it("负责人改为 DISABLED 员工 → 400 VALIDATION_FAILED", guard(async () => {
    const c = await mkContract("DRAFT", "OWNER-DISABLED");
    await expect(
      updateContract(adminUser!, c.id, { ownerUserId: disabledUser!.id })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));
});
