// createContract / updateContract 生产路径审计日志回归
//
// 覆盖:
//   1) createContract 成功后写 CONTRACT_CREATE 审计 (after 含关键字段)
//   2) updateContract 成功后写 CONTRACT_UPDATE 审计, before/after 只含实际变更字段
//   3) updateContract 无实际字段变更时不写 CONTRACT_UPDATE
//
// DB 不可达时整组 skip. 数据带唯一 TAG 前缀,跑完自清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { createContract, updateContract } from "@/server/services/contract";

let dbReachable = false;
const TAG = `TEST-CONTRACT-AUDIT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
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
  if (!adminRow) return;
  adminUser = { ...adminRow, roleCode: "ADMIN", permissions: [] };

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
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (createdContractIds.length > 0) {
      await prisma.operationLog.deleteMany({
        where: { entity: "Contract", entityId: { in: createdContractIds } }
      });
      await prisma.contractReviewLog.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
    }
    if (testCustomerId) {
      await prisma.customer.deleteMany({ where: { id: testCustomerId } });
    }
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !testCustomerId) return;
  await fn();
};

async function mkContract(suffix: string) {
  if (!adminUser || !testCustomerId) throw new Error("setup not ready");
  // 无附件 → 保持 DRAFT, 不触发 auto-publish, 审计只剩 CONTRACT_CREATE 一条
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
  return c;
}

async function findAuditLogs(contractId: string, action: string) {
  return prisma.operationLog.findMany({
    where: { entity: "Contract", entityId: contractId, action },
    orderBy: { at: "asc" }
  });
}

describe("createContract / updateContract 审计日志", () => {
  it("createContract 写 CONTRACT_CREATE, after 含关键字段", guard(async () => {
    const c = await mkContract("CREATE");
    const logs = await findAuditLogs(c.id, "CONTRACT_CREATE");
    expect(logs.length).toBe(1);
    const diff = logs[0]!.diff as { before: unknown; after: Record<string, unknown> };
    expect(diff.after).toMatchObject({
      contractNo: c.contractNo,
      title: `${TAG}-title-CREATE`,
      customerId: testCustomerId,
      status: "DRAFT",
      ownerUserId: adminUser!.id,
      signerId: adminUser!.id
    });
    // Decimal 序列化为字符串
    expect(String(diff.after.totalAmount)).toBe("10000");
    expect(String(diff.after.taxRate)).toBe("0.06");
    expect(logs[0]!.actorId).toBe(adminUser!.id);
  }));

  it("updateContract 写 CONTRACT_UPDATE, before/after 只含实际变更字段", guard(async () => {
    const c = await mkContract("UPDATE");
    await updateContract(adminUser!, c.id, { title: `${TAG}-title-UPDATED` });

    const logs = await findAuditLogs(c.id, "CONTRACT_UPDATE");
    expect(logs.length).toBe(1);
    const diff = logs[0]!.diff as { before: Record<string, unknown>; after: Record<string, unknown> };
    // 只有 title 变更, 不得整行 dump 其它字段
    expect(Object.keys(diff.after).sort()).toEqual(["title"]);
    expect(Object.keys(diff.before).sort()).toEqual(["title"]);
    expect(diff.before.title).toBe(`${TAG}-title-UPDATE`);
    expect(diff.after.title).toBe(`${TAG}-title-UPDATED`);
  }));

  it("updateContract 改总额时税额字段一并进 diff", guard(async () => {
    const c = await mkContract("AMOUNT");
    await updateContract(adminUser!, c.id, { totalAmount: 20000 });

    const logs = await findAuditLogs(c.id, "CONTRACT_UPDATE");
    expect(logs.length).toBe(1);
    const diff = logs[0]!.diff as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(Object.keys(diff.after).sort()).toEqual(["amountExcludingTax", "taxAmount", "totalAmount"]);
    expect(String(diff.after.totalAmount)).toBe("20000");
    expect(String(diff.before.totalAmount)).toBe("10000");
  }));

  it("updateContract 值未变时不写 CONTRACT_UPDATE", guard(async () => {
    const c = await mkContract("NOOP");
    await updateContract(adminUser!, c.id, { title: `${TAG}-title-NOOP` });

    const logs = await findAuditLogs(c.id, "CONTRACT_UPDATE");
    expect(logs.length).toBe(0);
  }));
});
