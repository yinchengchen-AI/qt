// 回归测试: 保存草稿报 500 (P2002 contractNo) 的修复.
//
// 根因: Contract.contractNo 原本是全局 @unique, 软删合同仍占着唯一索引,
// 用户重新录同号就被 DB 直接 P2002, 路由 catch 后变 500.
//
// 修复: 20260621_contract_no_partial_unique 迁移把全局索引换成
// `WHERE "deletedAt" IS NULL` 的部分唯一索引. 本测试:
//   1) 验证该索引已在 DB 上存在
//   2) 软删合同 + 新建同号 → 不抛 P2002
//   3) 两条活动合同同号 → 仍 P2002
//
// DB 不可达时整组 skip (开发机 / CI 没起 docker 时不阻塞).
// 测试用唯一前缀的 contractNo, 不会污染真实数据; 跑完自己清理.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";

let dbReachable = false;
const TAG = `TEST-PARTIAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdContractNos: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (createdContractNos.length > 0) {
      // 测试数据强制物理清理, 不会污染生产数据 (前缀已隔离)
      await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
    }
  } catch {
    // 忽略清理失败
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable) return;
  await fn();
};

describe("Contract.contractNo 部分唯一索引 (软删可复用)", () => {
  it("索引 Contract_contractNo_active_key 存在且为 partial unique", guard(async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'Contract' AND indexname = 'Contract_contractNo_active_key'
    `;
    expect(rows.length).toBe(1);
    const first = rows[0];
    expect(first).toBeDefined();
    const def = first!.indexdef.toLowerCase();
    expect(def).toContain("unique");
    expect(def).toContain("where");
    // 旧的全局唯一索引应该已经不存在
    const old = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'Contract' AND indexname = 'Contract_contractNo_key'
    `;
    expect(old.length).toBe(0);
  }));

  it("软删合同不阻塞同号新建", guard(async () => {
    const no = `${TAG}-REUSE`;
    createdContractNos.push(no);
    // 第一条: 活动合同
    const first = await prisma.contract.create({
      data: {
        contractNo: no,
        customerId: (await prisma.customer.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id,
        customerName: "TEST-PARTIAL-客户",
        title: "TEST-PARTIAL-title-1",
        serviceType: "OTHER",
        signDate: new Date("2026-01-01T00:00:00Z"),
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2026-12-31T00:00:00Z"),
        totalAmount: "0",
        taxRate: "0",
        taxAmount: "0",
        amountExcludingTax: "0",
        paymentMethod: "LUMP_SUM",
        ownerUserId: (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id,
        signerId: (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id,
        attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
        createdById: (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id,
        updatedById: (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id
      }
    });
    expect(first.id).toBeTruthy();
    // 软删它
    await prisma.contract.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    // 第二条: 同号新建 — 关键断言: 不抛 P2002
    const second = await prisma.contract.create({
      data: {
        contractNo: no,
        customerId: first.customerId,
        customerName: first.customerName,
        title: "TEST-PARTIAL-title-2",
        serviceType: "OTHER",
        signDate: new Date("2026-01-01T00:00:00Z"),
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2026-12-31T00:00:00Z"),
        totalAmount: "0",
        taxRate: "0",
        taxAmount: "0",
        amountExcludingTax: "0",
        paymentMethod: "LUMP_SUM",
        ownerUserId: first.ownerUserId,
        signerId: first.signerId,
        attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
        createdById: first.createdById,
        updatedById: first.updatedById
      }
    });
    expect(second.id).toBeTruthy();
    expect(second.id).not.toBe(first.id);
    expect(second.contractNo).toBe(no);
  }));

  it("两条活动合同同号仍触发 P2002", guard(async () => {
    const no = `${TAG}-COLLIDE`;
    createdContractNos.push(no);
    const customerId = (await prisma.customer.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const userId = (await prisma.user.findFirstOrThrow({ where: { deletedAt: null }, select: { id: true } })).id;
    const base = {
      contractNo: no,
      customerId,
      customerName: "TEST-PARTIAL-客户",
      serviceType: "OTHER",
      signDate: new Date("2026-01-01T00:00:00Z"),
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-12-31T00:00:00Z"),
      totalAmount: "0",
      taxRate: "0",
      taxAmount: "0",
      amountExcludingTax: "0",
      paymentMethod: "LUMP_SUM",
      ownerUserId: userId,
      signerId: userId,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: userId,
      updatedById: userId
    } as const;
    await prisma.contract.create({ data: { ...base, title: "TEST-PARTIAL-c1" } });
    await expect(
      prisma.contract.create({ data: { ...base, title: "TEST-PARTIAL-c2" } })
    ).rejects.toMatchObject({ code: "P2002" });
  }));
});
