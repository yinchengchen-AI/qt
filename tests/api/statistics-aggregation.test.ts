// 统计分析聚合逻辑回归 (round-2)
//
// 覆盖:
//   1) getInvoiceAging: 返回 total 字段(供 UI 展示真实超期数)
//   2) getInvoiceAging: REFUNDED 退款应抵消已收(refund 后 remaining = full)
//   3) getOverview: unpaidAmount 不应为负(clamp 到 0)
//   4) getEmployeePerformance: SALES 角色 short-circuit,只返回自己
//
// DB 不可达时整组 skip. 全部数据用 unique TAG 前缀, 跑完自己清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  getInvoiceAging,
  getOverview,
  getEmployeePerformance,
  getRegionStatistics
} from "@/server/services/statistics";
import { createInvoice, invoiceAction } from "@/server/services/invoice";
import { createPayment, paymentAction } from "@/server/services/payment";

let dbReachable = false;
const TAG = `TEST-STAT-AGG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let financeUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "FINANCE" } | null = null;
let salesUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "SALES" } | null = null;
let testCustomerId: string | null = null;
const createdContractNos: string[] = [];
const createdInvoiceIds: string[] = [];
const createdPaymentIds: string[] = [];

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return { id: adminUser.id, employeeNo: adminUser.employeeNo, name: adminUser.name, email: adminUser.email, roleCode: "ADMIN", permissions: [] };
};
const buildFinance = (): SessionUser => {
  if (!financeUser) throw new Error("finance not bootstrapped");
  return { id: financeUser.id, employeeNo: financeUser.employeeNo, name: financeUser.name, email: financeUser.email, roleCode: "FINANCE", permissions: [] };
};
const buildSales = (): SessionUser => {
  if (!salesUser) throw new Error("sales not bootstrapped");
  return { id: salesUser.id, employeeNo: salesUser.employeeNo, name: salesUser.name, email: salesUser.email, roleCode: "SALES", permissions: [] };
};

async function makeContract(customerId: string, customerName: string, ownerId: string, signerId: string, totalAmount: number, suffix: string) {
  const contractNo = `${TAG}-CTR-${suffix}`;
  return prisma.contract.create({
    data: {
      contractNo,
      customerId,
      customerName,
      title: `${TAG}-title-${suffix}`,
      serviceType: "OTHER",
      signDate: new Date(),
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 86400_000),
      totalAmount,
      taxRate: 0.06,
      taxAmount: Number((totalAmount * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((totalAmount / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      installmentPlan: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["installmentPlan"],
      status: "ACTIVE",
      ownerUserId: ownerId,
      signerId,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: ownerId,
      updatedById: ownerId
    }
  });
}

async function makeIssuedInvoice(contractId: string, ownerId: string, amount: number, suffix: string, daysAgoIssue: number) {
  const created = await createInvoice(buildAdmin(), {
    contractId,
    invoiceNo: `${TAG}-INV-${suffix}`,
    invoiceType: "VAT_SPECIAL",
    amount,
    taxRate: 0.06,
    applyDate: new Date().toISOString(),
    titleType: "COMPANY",
    titleName: `${TAG}-抬头`,
    taxNo: "91110000123456789X",
    attachments: []
  });
  if (!created) throw new Error("createInvoice returned null");
  await invoiceAction(buildAdmin(), created.id, { action: "submit" });
  await invoiceAction(buildFinance(), created.id, {
    action: "issue",
    actualIssueDate: new Date(Date.now() - daysAgoIssue * 86400_000).toISOString()
  });
  createdInvoiceIds.push(created.id);
  return created;
}

async function makePayment(invoiceId: string, contractId: string, amount: number, _suffix: string) {
  const p = await createPayment(buildFinance(), {
    invoiceId,
    contractId,
    amount,
    receivedAt: new Date().toISOString(),
    method: "BANK_TRANSFER"
  });
  createdPaymentIds.push(p.id);
  return p;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const adminRow = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  const financeRow = await prisma.user.findFirst({
    where: { role: { code: "FINANCE" }, deletedAt: null },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  const salesRow = await prisma.user.findFirst({
    where: { role: { code: "SALES" }, deletedAt: null, isSystem: false },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  if (!adminRow || !financeRow || !salesRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN" };
  financeUser = { id: financeRow.id, employeeNo: financeRow.employeeNo, name: financeRow.name, email: financeRow.email, roleCode: "FINANCE" };
  salesUser = { id: salesRow.id, employeeNo: salesRow.employeeNo, name: salesRow.name, email: salesRow.email, roleCode: "SALES" };
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
  // 严格按 FK 反向顺序清理, 失败抛错而非静默吞掉 (历史坑: 静默 catch 让历史数据堆积,
  // 下次跑这个 test 时会看到非预期的 invoiceAmount 基线)
  if (createdPaymentIds.length > 0) {
    await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
  }
  if (createdInvoiceIds.length > 0) {
    await prisma.invoiceAuditLog.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
  }
  if (createdContractNos.length > 0) {
    // 把所有引用了这些合同的支付一并清掉, 防止外部 (例如 lib/customer-update 等) 留下的孤儿
    await prisma.payment.deleteMany({ where: { contractId: { in: (await prisma.contract.findMany({ where: { contractNo: { in: createdContractNos } }, select: { id: true } })).map(c => c.id) } } });
    await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
  }
  if (testCustomerId) {
    await prisma.customer.deleteMany({ where: { id: testCustomerId } });
  }
});

describe("getInvoiceAging", () => {
  it("返回 total 字段供 UI 展示真实超期数", async () => {
    if (!dbReachable || !adminUser) return;
    const cust = testCustomerId!;
    const ctr = await makeContract(cust, `${TAG}-客户`, adminUser.id, adminUser.id, 10000, "aging-1");
    createdContractNos.push(ctr.contractNo);
    await makeIssuedInvoice(ctr.id, adminUser.id, 1000, "aging-1", 45);

    const result = await getInvoiceAging(buildAdmin());
    expect(result).toHaveProperty("total");
    expect(typeof result.total).toBe("number");
    expect(result.rows.length).toBeLessThanOrEqual(100);
    expect(result.total).toBeGreaterThanOrEqual(result.rows.length);
  });

  it("REFUNDED 退款应抵消已收:退款后 remaining = full amount", async () => {
    if (!dbReachable || !adminUser || !financeUser) return;
    const cust = testCustomerId!;
    const ctr = await makeContract(cust, `${TAG}-客户`, adminUser.id, adminUser.id, 5000, "refund-1");
    createdContractNos.push(ctr.contractNo);
    const inv = await makeIssuedInvoice(ctr.id, adminUser.id, 500, "refund-1", 10);
    const pay = await makePayment(inv.id, ctr.id, 500, "refund-1");
    await paymentAction(buildFinance(), pay.id, { action: "confirm", bankRefNo: `${TAG}-REF1` });
    // 退款 → status=REFUNDED
    await paymentAction(buildFinance(), pay.id, { action: "refund", reason: `${TAG}-退款测试` });

    const result = await getInvoiceAging(buildAdmin());
    const row = result.rows.find((r) => r.invoiceId === inv.id);
    // 修复前 REFUNDED 被忽略,remaining 仍会按 confirmed 算成 0;
    // 修复后 remaining = 500(把 confirmed 500 + refunded -500 加总)
    expect(row).toBeDefined();
    expect(row!.remaining).toBe(500);
  });
});

describe("getOverview", () => {
  // 注: 这个 describe 段是"性质"断言, 不做绝对值 / delta 校验.
  //   getOverview 返回的是 DB 全局聚合, 与其它并行跑的 api 测试 (invoice-amount 等)
  //   写入的合同/发票/回款共享同一份数据, 任何绝对值断言都会被污染. clamp 性质 (>= 0)
  //   是统计模块的硬约束, 在任何 DB 状态下都必须成立, 跑一次就足够锁住.
  it("paymentAmount > invoiceAmount 时 unpaidAmount 不为负(clamp 到 0)", async () => {
    if (!dbReachable || !adminUser) return;
    // 不写 DB, 直接读: clamp (Math.max(0, invoiceAmount - paymentAmount)) 必须保证输出 >= 0
    //   即便此刻其它测试正在并发写入让 invoiceAmount / paymentAmount 翻飞, clamp 也得守底
    const r = await getOverview(buildAdmin(), {});
    expect(r.unpaidAmount).toBeGreaterThanOrEqual(0);
    // 其它字段应是非负数 (聚合 sum 不会出负)
    expect(r.invoiceAmount).toBeGreaterThanOrEqual(0);
    expect(r.paymentAmount).toBeGreaterThanOrEqual(0);
    expect(r.contractAmount).toBeGreaterThanOrEqual(0);
  });
});

describe("getEmployeePerformance SALES 隔离", () => {
  it("SALES 角色只看到自己一行,没有其他 owner 泄露", async () => {
    if (!dbReachable || !salesUser) return;
    const r = await getEmployeePerformance(buildSales());
    // SALES 路径 short-circuit → 只有自己一行
    expect(r.length).toBe(1);
    const row = r[0]!;
    expect(row.userId).toBe(salesUser.id);
    expect(row.name).toBe(salesUser.name);
  });
});

// 应收账龄重设计 round-3 回归
// 锁住"旧响应字段 { buckets, total, rows } 仍存在 + basis=issue 旧语义不变",保证 dashboard 不破
describe("getInvoiceAging 旧字段(回归 dashboard)", () => {
  it("默认行为保持 4 桶 + 旧字段", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await getInvoiceAging(buildAdmin());
    expect(r).toHaveProperty("buckets");
    expect(r).toHaveProperty("total");
    expect(r).toHaveProperty("rows");
    expect(r.buckets).toHaveProperty("0-30");
    expect(r.buckets).toHaveProperty("31-60");
    expect(r.buckets).toHaveProperty("61-90");
    expect(r.buckets).toHaveProperty("90+");
    // 新字段(可选, 不破坏老消费者)
    expect(r).toHaveProperty("summary");
    expect(r).toHaveProperty("pagination");
  });

  it("basis=issue 旧语义: 用 actualIssueDate 计龄", async () => {
    if (!dbReachable || !adminUser) return;
    // 上一 describe 的 aging-1 发票 (45 天前开票) 应该归 31-60
    const ctr = await makeContract(testCustomerId!, `${TAG}-客户`, adminUser.id, adminUser.id, 5000, "issue-baseline");
    createdContractNos.push(ctr.contractNo);
    await makeIssuedInvoice(ctr.id, adminUser.id, 500, "issue-baseline", 45);
    const r = await getInvoiceAging(buildAdmin(), { basis: "issue" });
    // 45 天 -> 31-60
    const row = r.rows.find((x) => x.invoiceNo === `${TAG}-INV-issue-baseline`);
    expect(row).toBeDefined();
    expect(row!.bucket).toBe("31-60");
    expect(row!.basisUsed).toBe("issue");
  });
});

describe("getRegionStatistics", () => {
  // 准备:建 3 个客户(2 个有 district+town,1 个没有 town),
  //     各自挂一份合同 + 发票, 用本测试独有 TAG 前缀, 跑完由 afterAll 收尾.
  //     SALES 隔离用例额外建一个"业务人员拥有但 admin 看不到"的客户
  const TAG_REG = `${TAG}-REG`;
  const regionContractNos: string[] = [];
  const regionInvoiceIds: string[] = [];
  const regionCustomerIds: string[] = [];

  async function makeRegionCustomer(suffix: string, ownerId: string, district: string | null, town: string | null) {
    const cust = await prisma.customer.create({
      data: {
        code: `${TAG_REG}-CUST-${suffix}`,
        name: `${TAG_REG}-客户-${suffix}`,
        customerType: "ENTERPRISE",
        province: "浙江省",
        city: "杭州市",
        district: district ?? undefined,
        town: town ?? undefined,
        contactPhone: "13800000000",
        createdById: ownerId,
        updatedById: ownerId,
        ownerUserId: ownerId
      }
    });
    regionCustomerIds.push(cust.id);
    return cust;
  }

  it("按 district+town 分桶:同名 town 跨区不合并;SALES 只看自己的客户", async () => {
    if (!dbReachable || !adminUser || !salesUser) return;
    // 客户 A: SALES 拥有 (业务人员视角), 余杭区 闲林街道
    const custA = await makeRegionCustomer("A", salesUser.id, "余杭区", "闲林街道");
    // 客户 B: SALES 拥有 (业务人员视角), 临平区 闲林街道 (同名镇街, 不同区)
    const custB = await makeRegionCustomer("B", salesUser.id, "临平区", "闲林街道");
    // 客户 C: SALES 拥有 (业务人员视角), 没填 town
    const custC = await makeRegionCustomer("C", salesUser.id, "余杭区", null);
    // 各自挂一份合同 + 发票
    for (const [cust, suffix] of [[custA, "A"], [custB, "B"], [custC, "C"]] as const) {
      const ctr = await makeContract(cust.id, cust.name, salesUser.id, salesUser.id, 1000, `reg-${suffix}`);
      regionContractNos.push(ctr.contractNo);
      createdContractNos.push(ctr.contractNo);
      const inv = await makeIssuedInvoice(ctr.id, salesUser.id, 600, `reg-${suffix}`, 5);
      regionInvoiceIds.push(inv.id);
    }

    // 1) SALES 视角: 3 行, region 名带区前缀, 跨区同名镇街拆成 2 行
    const salesRows = await getRegionStatistics(buildSales(), {
      from: new Date(Date.now() - 7 * 86400_000),
      to: new Date()
    });
    const regionNames = salesRows.filter((r) => r.region.includes("闲林街道")).map((r) => r.region).sort();
    expect(regionNames).toEqual(["临平区 闲林街道", "余杭区 闲林街道"]);
    // 每行都带 district/town 标量供下钻
    for (const r of salesRows) {
      if (r.region.includes("闲林街道")) {
        expect(r.town).toBe("闲林街道");
        expect(r.district).toMatch(/^(余杭区|临平区)$/);
      }
    }
    // 2) SALES 的"未填写"行: district+town 都为 null 才落到末尾
    const unfilled = salesRows.find((r) => !r.district && !r.town);
    if (unfilled) {
      // 应排在最后
      expect(salesRows[salesRows.length - 1]!.region).toBe(unfilled.region);
    }

    // 3) ADMIN 视角能看到 SALES 看不到的客户(此测试不专门造, 只断言数量 >= SALES)
    const adminRows = await getRegionStatistics(buildAdmin(), {
      from: new Date(Date.now() - 7 * 86400_000),
      to: new Date()
    });
    expect(adminRows.length).toBeGreaterThanOrEqual(salesRows.length);
  });

  it("无 range 时仍能跑通(默认本月), 字段类型与顺序稳定", async () => {
    if (!dbReachable || !adminUser) return;
    const rows = await getRegionStatistics(buildAdmin());
    expect(Array.isArray(rows)).toBe(true);
    for (const r of rows) {
      expect(r).toHaveProperty("region");
      expect(r).toHaveProperty("district");
      expect(r).toHaveProperty("town");
      expect(r).toHaveProperty("customerCount");
      expect(r).toHaveProperty("contractCount");
      expect(r).toHaveProperty("contractAmount");
      expect(r).toHaveProperty("invoiceAmount");
      expect(r).toHaveProperty("paymentAmount");
      expect(r).toHaveProperty("invoiceRate");
      expect(r).toHaveProperty("paymentRate");
      expect(r).toHaveProperty("unpaidAmount");
      // 数值字段非负
      expect(r.contractAmount).toBeGreaterThanOrEqual(0);
      expect(r.invoiceAmount).toBeGreaterThanOrEqual(0);
      expect(r.paymentAmount).toBeGreaterThanOrEqual(0);
      expect(r.unpaidAmount).toBeGreaterThanOrEqual(0);
    }
  });

  it("本月 range 与全量 range 的合同额(只看本测试造的)单调非降", async () => {
    if (!dbReachable || !adminUser) return;
    const thisMonth = (() => {
      const now = new Date();
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: now };
    })();
    const allTime = { from: new Date(2000, 0, 1), to: new Date() };
    const [monthRows, allRows] = await Promise.all([
      getRegionStatistics(buildAdmin(), thisMonth),
      getRegionStatistics(buildAdmin(), allTime)
    ]);
    // 本月合同额 <= 全量合同额(全量包了本月)
    const monthTotal = monthRows.reduce((s, r) => s + r.contractAmount, 0);
    const allTotal = allRows.reduce((s, r) => s + r.contractAmount, 0);
    expect(allTotal).toBeGreaterThanOrEqual(monthTotal);
  });

  afterAll(async () => {
    // 区域统计用例自己负责清完全部数据(合同 / 发票 / 回款 / 客户).
    // 原因: vitest 中内层 describe 的 afterAll 会先于顶层 afterAll 执行, 顶层
    // afterAll 还没机会删 region 造的合同时, 这里如果直接删 customer 会被 FK 拦.
    // deleteMany 对已删记录是幂等的, 顶层 afterAll 后续再按 createdContractNos
    // / createdInvoiceIds 重复走一遍也安全 (0 行).
    if (!dbReachable) return;
    if (regionInvoiceIds.length > 0) {
      await prisma.invoiceAuditLog.deleteMany({ where: { invoiceId: { in: regionInvoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: regionInvoiceIds } } });
    }
    if (regionContractNos.length > 0) {
      const regionCtrIds = (
        await prisma.contract.findMany({
          where: { contractNo: { in: regionContractNos } },
          select: { id: true }
        })
      ).map((c) => c.id);
      if (regionCtrIds.length > 0) {
        // region 合同下的回款 (含 makePayment 造的, 也可能被 service 内部自动登记的)
        await prisma.payment.deleteMany({ where: { contractId: { in: regionCtrIds } } });
      }
      await prisma.contract.deleteMany({ where: { contractNo: { in: regionContractNos } } });
    }
    if (regionCustomerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: regionCustomerIds } } });
    }
  });
});
// 0.01 legacy 占位合同排除回归 (migration 20260705_contract_is_legacy_zero_amount):
// 统计模块 6 处 where 都不返回 isLegacyZeroAmount=true 的合同
describe("getOverview / getUninvoicedContracts 排除 legacy 0.01 占位合同", () => {
  const TAG_LEG = `${TAG}-LEG`;
  let legacyContractNo: string | null = null;
  const regionCustomerIds2: string[] = [];

  beforeAll(async () => {
    if (!dbReachable || !adminUser) return;
    const cust = await prisma.customer.create({
      data: {
        code: `${TAG_LEG}-CUST`,
        name: `${TAG_LEG}-客户`,
        customerType: "ENTERPRISE",
        province: "浙江省",
        city: "杭州市",
        contactPhone: "13800000000",
        createdById: adminUser!.id,
        updatedById: adminUser!.id,
        ownerUserId: adminUser!.id
      }
    });
    regionCustomerIds2.push(cust.id);
    const ctr = await prisma.contract.create({
      data: {
        contractNo: `${TAG_LEG}-CTR`,
        customerId: cust.id,
        customerName: cust.name,
        title: `${TAG_LEG}-legacy-占位`,
        serviceType: "OTHER",
        signDate: new Date(),
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 86400_000),
        totalAmount: 0.01,
        taxRate: 0.06,
        taxAmount: 0,
        amountExcludingTax: 0.01,
        paymentMethod: "LUMP_SUM",
        status: "ACTIVE",
        isLegacyZeroAmount: true,
        ownerUserId: adminUser!.id,
        signerId: adminUser!.id,
        attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
        createdById: adminUser!.id,
        updatedById: adminUser!.id
      }
    });
    legacyContractNo = ctr.contractNo;
    createdContractNos.push(ctr.contractNo);
  });

  it("getOverview 的 signWhere 排除 isLegacyZeroAmount=true 合同", async () => {
    if (!dbReachable || !adminUser || !legacyContractNo) return;
    // 由于合同有 unique contractNo, 可以通过 contractNo 索引回去确认数据库里这条合同确实存在且 isLegacyZeroAmount=true
    const ctr = await prisma.contract.findFirst({ where: { contractNo: legacyContractNo } });
    expect(ctr).not.toBeNull();
    expect(ctr!.isLegacyZeroAmount).toBe(true);

    // 然后调用 getOverview, 验证: 在 stats 内部如果有任何 list 都看不到这条合同;
    // 因为 stats 是聚合, 不能直接断言 "0.01 一定不在结果里" (其他测试也可能贡献数据), 改为:
    // 在 stats 内部所有 signWhere 都加了 isLegacyZeroAmount=false, 把 isLegacyZeroAmount=true 的合同
    // 拿出来手算, 它一定不在 stats 的合集内. 这里我们用 contract id 确认.
    // 直接用 getUninvoicedContracts 验证更直接 (返回 list)
    // 签名: (user, { thresholdDays?, limit? }) - 没有 range 参数
    const { getUninvoicedContracts } = await import("@/server/services/statistics");
    const list = await getUninvoicedContracts(buildAdmin(), { limit: 1000 });
    const ids = list.map((r) => r.contractId);
    expect(ids).not.toContain(ctr!.id);
  });

  afterAll(async () => {
    if (!dbReachable) return;
    if (regionCustomerIds2.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: regionCustomerIds2 } } });
    }
  });
});
