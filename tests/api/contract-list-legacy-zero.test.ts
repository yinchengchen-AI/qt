// listContracts 默认隐藏 legacy 0.01 占位合同, opt-in 时显示
//
// 背景: legacy-fineui.mjs 迁移时把 FineUI 旧系统 ContractAmount<=0 的合同 totalAmount
//       写成 0.01 占位, 并打 isLegacyZeroAmount=true 标记 (migration 20260705 加字段).
//       业务列表/统计默认排除这些合同, 审计/对账时显式 includeLegacyZeroAmount=true 打开.
//
// 覆盖:
//   1) 默认 listContracts 不返回 isLegacyZeroAmount=true 合同
//   2) includeLegacyZeroAmount=true 时返回所有(含 isLegacyZeroAmount=true)
//   3) includeLegacyZeroAmount=false / "0" / undefined 行为同默认 (排除)
//   4) includeLegacyZeroAmount="1" / "true" 行为同 true (包含)
//
// DB 不可达时整组 skip. 数据用 unique TAG 前缀, afterAll 自清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { listContracts } from "@/server/services/contract";

let dbReachable = false;
const TAG = `TEST-CTR-LIST-LEGACY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let realContractId: string | null = null;
let legacyContractId: string | null = null;
let testCustomerId: string | null = null;

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

  // 真实业务合同: totalAmount=10000, isLegacyZeroAmount 默认 false
  const real = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-REAL`,
      customerId: cust.id,
      customerName: cust.name,
      title: `${TAG}-真实合同`,
      serviceType: "OTHER",
      signDate: new Date(),
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 86400_000),
      totalAmount: 10000,
      taxRate: 0.06,
      taxAmount: Number((10000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((10000 / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: adminUser.id,
      signerId: adminUser.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
  realContractId = real.id;

  // legacy 占位合同: totalAmount=0.01, isLegacyZeroAmount=true
  const legacy = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-LEGACY`,
      customerId: cust.id,
      customerName: cust.name,
      title: `${TAG}-legacy-占位`,
      serviceType: "OTHER",
      signDate: new Date(),
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 86400_000),
      totalAmount: 0.01,
      taxRate: 0.06,
      taxAmount: 0,
      amountExcludingTax: 0.01,
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      isLegacyZeroAmount: true,
      ownerUserId: adminUser.id,
      signerId: adminUser.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
  legacyContractId = legacy.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (realContractId) await prisma.contract.deleteMany({ where: { id: realContractId } });
    if (legacyContractId) await prisma.contract.deleteMany({ where: { id: legacyContractId } });
    if (testCustomerId) await prisma.customer.deleteMany({ where: { id: testCustomerId } });
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

async function fetchByCustomer(customerId: string, includeLegacyZeroAmount: boolean | string | undefined) {
  if (!adminUser) throw new Error("setup not ready");
  // 用 customerId 锁定本测试造的两条合同, 不受其他并行测试数据干扰
  const result = await listContracts(adminUser, {
    page: 1,
    pageSize: 100,
    customerId,
    ...(includeLegacyZeroAmount === undefined ? {} : { includeLegacyZeroAmount })
  });
  return result.list;
}

describe("listContracts legacy 0.01 占位合同过滤", () => {
  it("默认 (includeLegacyZeroAmount=undefined) 排除 isLegacyZeroAmount=true 合同", async () => {
    if (!dbReachable || !testCustomerId) return;
    const rows = await fetchByCustomer(testCustomerId, undefined);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(realContractId);
    expect(ids).not.toContain(legacyContractId);
  });

  it("includeLegacyZeroAmount=false 行为同默认", async () => {
    if (!dbReachable || !testCustomerId) return;
    const rows = await fetchByCustomer(testCustomerId, false);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(realContractId);
    expect(ids).not.toContain(legacyContractId);
  });

  it('includeLegacyZeroAmount="false" / "0" 行为同默认', async () => {
    if (!dbReachable || !testCustomerId) return;
    for (const v of ["false", "0"]) {
      const rows = await fetchByCustomer(testCustomerId, v);
      const ids = rows.map((r) => r.id);
      expect(ids, `value=${v}`).toContain(realContractId);
      expect(ids, `value=${v}`).not.toContain(legacyContractId);
    }
  });

  it("includeLegacyZeroAmount=true 返回全量 (含 legacy)", async () => {
    if (!dbReachable || !testCustomerId) return;
    const rows = await fetchByCustomer(testCustomerId, true);
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(realContractId);
    expect(ids).toContain(legacyContractId);
  });

  it('includeLegacyZeroAmount="true" / "1" 行为同 true', async () => {
    if (!dbReachable || !testCustomerId) return;
    for (const v of ["true", "1"]) {
      const rows = await fetchByCustomer(testCustomerId, v);
      const ids = rows.map((r) => r.id);
      expect(ids, `value=${v}`).toContain(realContractId);
      expect(ids, `value=${v}`).toContain(legacyContractId);
    }
  });
});