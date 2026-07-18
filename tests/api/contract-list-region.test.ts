// listContracts 客户区域 (省/市/区/镇街) 过滤 + 返回行携带拍平的区域字段
//
// 背景: 合同管理页新增"按客户区域查询" / 列表"客户区域"列 / 导出带客户区域.
//       区域存在 Customer 表 (province/city/district/town), listContracts 走 customer
//       关系 equals 匹配, 并把区域拍平成 customerProvince/City/District/Town 返回.
//
// 覆盖:
//   1) province / city / district / town 单条件过滤命中对应合同
//   2) province+city 组合过滤
//   3) 区域不匹配时结果为空
//   4) 纯区域过滤 (不带 customerId) 能命中且排除其它区域合同
//   5) 返回行携带 customerProvince / customerCity / customerDistrict / customerTown
//
// DB 不可达时整组 skip. 数据用 unique TAG 前缀, afterAll 自清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { listContracts } from "@/server/services/contract";

let dbReachable = false;
const TAG = `TEST-CTR-LIST-REGION-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let customerAId: string | null = null; // 浙江省 / 杭州市 / 西湖区 / 留下街道
let customerBId: string | null = null; // 江苏省 / 南京市 / 鼓楼区 / 湖南路街道
let contractAId: string | null = null;
let contractBId: string | null = null;

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

  const custA = await prisma.customer.create({
    data: {
      code: `${TAG}-CUST-A`,
      name: `${TAG}-客户A`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      district: "西湖区",
      town: "留下街道",
      contactPhone: "13800000000",
      createdById: adminUser.id,
      updatedById: adminUser.id,
      ownerUserId: adminUser.id
    }
  });
  customerAId = custA.id;

  const custB = await prisma.customer.create({
    data: {
      code: `${TAG}-CUST-B`,
      name: `${TAG}-客户B`,
      customerType: "ENTERPRISE",
      province: "江苏省",
      city: "南京市",
      district: "鼓楼区",
      town: "湖南路街道",
      contactPhone: "13900000000",
      createdById: adminUser.id,
      updatedById: adminUser.id,
      ownerUserId: adminUser.id
    }
  });
  customerBId = custB.id;

  const mkContract = (suffix: string, cust: { id: string; name: string }) => ({
    contractNo: `${TAG}-${suffix}`,
    customerId: cust.id,
    customerName: cust.name,
    title: `${TAG}-合同${suffix}`,
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
    ownerUserId: adminUser!.id,
    signerId: adminUser!.id,
    attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
    createdById: adminUser!.id,
    updatedById: adminUser!.id
  });

  const a = await prisma.contract.create({ data: mkContract("A", custA) });
  contractAId = a.id;
  const b = await prisma.contract.create({ data: mkContract("B", custB) });
  contractBId = b.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    const ids = [contractAId, contractBId].filter(Boolean) as string[];
    if (ids.length) await prisma.contract.deleteMany({ where: { id: { in: ids } } });
    const custIds = [customerAId, customerBId].filter(Boolean) as string[];
    if (custIds.length) await prisma.customer.deleteMany({ where: { id: { in: custIds } } });
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

async function listBy(params: Record<string, unknown>) {
  if (!adminUser) throw new Error("setup not ready");
  const result = await listContracts(adminUser, {
    page: 1,
    pageSize: 100,
    ...params
  } as Parameters<typeof listContracts>[1]);
  return result.list;
}

describe("listContracts 客户区域过滤", () => {
  it("province 单条件命中对应合同", async () => {
    if (!dbReachable || !customerAId) return;
    const rows = await listBy({ customerId: customerAId, province: "浙江省" });
    expect(rows.map((r) => r.id)).toContain(contractAId);
    const miss = await listBy({ customerId: customerAId, province: "江苏省" });
    expect(miss.map((r) => r.id)).not.toContain(contractAId);
  });

  it("city 单条件命中对应合同", async () => {
    if (!dbReachable || !customerAId) return;
    const rows = await listBy({ customerId: customerAId, city: "杭州市" });
    expect(rows.map((r) => r.id)).toContain(contractAId);
    const miss = await listBy({ customerId: customerAId, city: "南京市" });
    expect(miss.map((r) => r.id)).not.toContain(contractAId);
  });

  it("district 单条件命中对应合同", async () => {
    if (!dbReachable || !customerAId) return;
    const rows = await listBy({ customerId: customerAId, district: "西湖区" });
    expect(rows.map((r) => r.id)).toContain(contractAId);
    const miss = await listBy({ customerId: customerAId, district: "鼓楼区" });
    expect(miss.map((r) => r.id)).not.toContain(contractAId);
  });

  it("town 单条件命中对应合同", async () => {
    if (!dbReachable || !customerAId) return;
    const rows = await listBy({ customerId: customerAId, town: "留下街道" });
    expect(rows.map((r) => r.id)).toContain(contractAId);
    const miss = await listBy({ customerId: customerAId, town: "湖南路街道" });
    expect(miss.map((r) => r.id)).not.toContain(contractAId);
  });

  it("province+city 组合过滤", async () => {
    if (!dbReachable || !customerBId) return;
    const rows = await listBy({ customerId: customerBId, province: "江苏省", city: "南京市" });
    expect(rows.map((r) => r.id)).toContain(contractBId);
    const miss = await listBy({ customerId: customerBId, province: "江苏省", city: "杭州市" });
    expect(miss.map((r) => r.id)).not.toContain(contractBId);
  });

  it("纯区域过滤 (不带 customerId) 命中本区域合同并排除其它区域", async () => {
    if (!dbReachable || !customerAId) return;
    const rows = await listBy({ province: "浙江省", city: "杭州市", district: "西湖区", town: "留下街道" });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(contractAId);
    expect(ids).not.toContain(contractBId);
  });

  it("返回行携带拍平的客户区域字段", async () => {
    if (!dbReachable || !customerAId) return;
    const rows = await listBy({ customerId: customerAId });
    const row = rows.find((r) => r.id === contractAId);
    expect(row).toBeDefined();
    expect(row?.customerProvince).toBe("浙江省");
    expect(row?.customerCity).toBe("杭州市");
    expect(row?.customerDistrict).toBe("西湖区");
    expect(row?.customerTown).toBe("留下街道");
  });
});
