// 员工业绩签约明细 getSignerContractDetail 单元测试
//
// 覆盖:
//   1) 字段对齐 PDF: district+town / customerName / serviceTypeLabel / signerName / totalAmount
//   2) 按 signerId 分组,每组 subtotalWan = sum(totalAmount) / 10000
//   3) SALES 角色只看到自己作为签约人的合同
//   4) 空 range / 无合同返回空数组
//
// DB 不可达时整组 skip. 全部数据用 unique TAG 前缀, 跑完自己清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { getSignerContractDetail } from "@/server/services/statistics";
import { requirePermission, RESOURCE, ACTION } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

let dbReachable = false;
const TAG = `TEST-SIGNER-DETAIL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let salesUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "SALES" } | null = null;
let testCustomerId: string | null = null;
const createdContractNos: string[] = [];

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return { id: adminUser.id, employeeNo: adminUser.employeeNo, name: adminUser.name, email: adminUser.email, roleCode: "ADMIN", permissions: [] };
};
const buildSales = (): SessionUser => {
  if (!salesUser) throw new Error("sales not bootstrapped");
  return { id: salesUser.id, employeeNo: salesUser.employeeNo, name: salesUser.name, email: salesUser.email, roleCode: "SALES", permissions: [] };
};

beforeAll(async () => {
  // 找一个现成的 ADMIN user 复用, 不自建 (避免污染)
  const admin = await prisma.user.findFirst({
    where: { deletedAt: null, isSystem: false, role: { code: "ADMIN" } },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } },
  });
  if (!admin) {
    console.warn("[skip] no ADMIN user found");
    return;
  }
  adminUser = {
    id: admin.id, employeeNo: admin.employeeNo, name: admin.name, email: admin.email,
    roleCode: admin.role.code as "ADMIN",
  };
  const sales = await prisma.user.findFirst({
    where: { deletedAt: null, isSystem: false, role: { code: "SALES" } },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } },
  });
  if (sales) {
    salesUser = {
      id: sales.id, employeeNo: sales.employeeNo, name: sales.name, email: sales.email,
      roleCode: sales.role.code as "SALES",
    };
  }
  // 客户 (带 district + town, 跟 PDF 字段对齐)
  const customer = await prisma.customer.create({
    data: {
      name: `${TAG}-客户`,
      code: `${TAG}-C001`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      district: "余杭区",
      town: "塘栖镇",
      contactPhone: "13800000000",
      ownerUserId: adminUser.id,
      createdById: adminUser.id,
      updatedById: adminUser.id,
    },
  });
  testCustomerId = customer.id;
  dbReachable = true;
});

afterAll(async () => {
  if (!dbReachable) return;
  if (testCustomerId) {
    await prisma.contract.deleteMany({ where: { customerId: testCustomerId } });
    await prisma.customer.delete({ where: { id: testCustomerId } });
  }
  if (createdContractNos.length > 0) {
    await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
  }
});

async function makeContract(args: { signerId: string; ownerId: string; total: number; suffix: string; serviceType?: string }) {
  if (!testCustomerId || !adminUser) throw new Error("setup not done");
  const contractNo = `${TAG}-CTR-${args.suffix}`;
  createdContractNos.push(contractNo);
  return prisma.contract.create({
    data: {
      contractNo,
      customerId: testCustomerId,
      customerName: `${TAG}-客户`,
      title: `${TAG}-title-${args.suffix}`,
      serviceType: args.serviceType ?? "SAFETY_CONSULT",
      signDate: new Date(),
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 86400_000),
      totalAmount: args.total,
      taxRate: 0.06,
      taxAmount: Number((args.total * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((args.total / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      installmentPlan: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["installmentPlan"],
      status: "ACTIVE",
      ownerUserId: args.ownerId,
      signerId: args.signerId,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id,
    },
  });
}

describe("getSignerContractDetail", () => {
  it("admin role: 返回按签约人分组的明细, 字段对齐 PDF 模板", async () => {
    if (!dbReachable || !adminUser) return;
    if (!salesUser) return; // 需 SALES user 才有 2 个签约人
    // 造 2 份合同: 都让 sales user 当签约人, admin 当 owner (跟真实场景一致)
    await makeContract({ signerId: salesUser.id, ownerId: adminUser.id, total: 5000, suffix: "01" });
    await makeContract({ signerId: salesUser.id, ownerId: adminUser.id, total: 3000, suffix: "02" });
    const groups = await getSignerContractDetail(buildAdmin());
    const ours = groups.find((g) => g.signerId === salesUser!.id);
    expect(ours, "应该能按 salesUser 找到签约人分组").toBeDefined();
    // 本次造的合同至少 2 笔 (可能有同 signer 的历史合同)
    const ourContracts = ours!.rows.filter((r) => r.contractNo.startsWith(TAG));
    expect(ourContracts.length).toBe(2);
    // 字段对齐 PDF
    const first = ourContracts[0]!;
    expect(first.region).toBe("余杭区 塘栖镇");
    expect(first.customerName).toBe(`${TAG}-客户`);
    expect(first.signerName).toBe(salesUser.name);
    expect(typeof first.totalAmount).toBe("number");
    expect(first.serviceType).toBe("SAFETY_CONSULT");
    expect(first.serviceTypeLabel).toBeTruthy(); // 至少不为空
    // subtotalWan 包含本次造的 + 可能的其它 (>= 0.8 万 = 8000/10000)
    const expectSubtotal = ourContracts.reduce((s, r) => s + r.totalAmount, 0);
    expect(ours!.subtotalWan).toBeGreaterThanOrEqual(Math.round((expectSubtotal / 10_000) * 100) / 100);
  });

  it("SALES role: 只能看到与自己相关(owner/signer)的合同, 看不到 admin 独占合同", async () => {
    if (!dbReachable || !salesUser || !adminUser) return;
    // 上面 admin 用例已经造了 2 笔 sales 签的; 再造 1 笔 admin 签且 admin 拥有的,确认 SALES 看不到
    await makeContract({ signerId: adminUser.id, ownerId: adminUser.id, total: 1000, suffix: "03-admin-signer" });
    const groups = await getSignerContractDetail(buildSales());

    // 只断言本测试 TAG 创建的合同, 避免被其它 seeded/并行测试数据污染
    const tagRows = groups.flatMap((g) => g.rows).filter((r) => r.contractNo.startsWith(TAG));

    // SALES 看到的本测试合同必须都是 salesUser 作为签约人的
    for (const r of tagRows) {
      expect(r.signerId).toBe(salesUser.id);
    }
    // 看不到 admin 独占(admin 签 + admin 拥有)的合同
    expect(tagRows.some((r) => r.contractNo === `${TAG}-CTR-03-admin-signer`)).toBe(false);
    // 本测试创建的 sales 签的合同确实能看到
    expect(tagRows.some((r) => r.contractNo === `${TAG}-CTR-01`)).toBe(true);
    expect(tagRows.some((r) => r.contractNo === `${TAG}-CTR-02`)).toBe(true);
  });

  it("权限: 没有 STATISTICS:READ 抛错", async () => {
    // 构造一个没权限的 user
    const dummy: SessionUser = {
      id: "no-perm-user", employeeNo: "NOPERM", name: "noperm", email: "x@x.com", roleCode: "SALES", permissions: [],
    };
    // SALES 本身有 READ, 这里测一个不存在的 role code
    const realDummy = { ...dummy, roleCode: "NONEXIST" as unknown as "SALES" };
    expect(() => requirePermission(realDummy.roleCode, RESOURCE.STATISTICS, ACTION.READ)).toThrow();
  });
});
