// 统一业绩排行 API 回归 (round-4: /api/statistics/performance + getPerformanceRanking)
//
// 覆盖:
//   1) 路由默认 dimension=owner, 返回 ok({ rows, range })
//   2) Zod 校验: 非法 dimension → 400 VALIDATION_FAILED
//   3) limit 截断: limit=1 只回 1 行
//   4) preset=year: range.from = 当年 1 月 1 日
//   5) owner 维度: 开票率/回款率/未回款口径 (contract=10000, invoice=6000, payment=3000)
//   6) SALES 行级隔离: owner / signer / region 三维度都只看到自己
//   7) signer 维度: key=userId + employeeNo 字段
//   8) region 维度: district/town/customerCount 字段
//
// DB 不可达时整组 skip. 全部数据用 unique TAG 前缀 + 专用 SALES 用户,
// 避免与并行测试共享 admin 聚合基线, 跑完自己清理.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import { GET as getPerformance } from "@/app/api/statistics/performance/route";
import { createInvoice, invoiceAction } from "@/server/services/invoice";
import { createPayment, paymentAction } from "@/server/services/payment";

// 路由测试用: mock requireSession 返回当前 actor (per-case 注入)
const sessionHolder = vi.hoisted(() => ({ actor: null as SessionUser | null }));
vi.mock("@/lib/session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...mod,
    requireSession: async (): Promise<SessionUser> => {
      if (!sessionHolder.actor) throw new ApiError(ERROR_CODES.UNAUTHORIZED, "请先登录", 401);
      return sessionHolder.actor;
    }
  };
});

let dbReachable = false;
const TAG = `TEST-PERF-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let financeUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;
let salesUserId: string | null = null;
let testCustomerId: string | null = null;
const createdContractNos: string[] = [];
const createdInvoiceIds: string[] = [];
const createdPaymentIds: string[] = [];

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return adminUser;
};
const buildFinance = (): SessionUser => {
  if (!financeUser) throw new Error("finance not bootstrapped");
  return financeUser;
};
const buildSales = (): SessionUser => {
  if (!salesUser) throw new Error("sales not bootstrapped");
  return salesUser;
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

async function makeConfirmedPayment(invoiceId: string, contractId: string, amount: number, suffix: string) {
  const p = await createPayment(buildFinance(), {
    invoiceId,
    contractId,
    amount,
    receivedAt: new Date().toISOString(),
    method: "BANK_TRANSFER"
  });
  await paymentAction(buildFinance(), p.id, { action: "confirm", bankRefNo: `${TAG}-REF-${suffix}` });
  createdPaymentIds.push(p.id);
  return p;
}

const callPerformance = (qs: string) => {
  sessionHolder.actor = buildSales();
  return getPerformance(new Request(`http://localhost/api/statistics/performance?${qs}`)).then((r) => r.json());
};

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
  if (!adminRow || !financeRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN", permissions: [] };
  financeUser = { id: financeRow.id, employeeNo: financeRow.employeeNo, name: financeRow.name, email: financeRow.email, roleCode: "FINANCE", permissions: [] };

  // 专用 SALES 用户: 行级隔离 + 干净的单用户聚合基线
  const sales = await prisma.user.create({
    data: {
      employeeNo: `${TAG}-SLS`,
      name: `${TAG}-业务员`,
      email: `${TAG}-sales@example.com`,
      passwordHash: "not-valid",
      role: { connect: { code: "SALES" } }
    },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  salesUserId = sales.id;
  salesUser = { id: sales.id, employeeNo: sales.employeeNo, name: sales.name, email: sales.email, roleCode: "SALES", permissions: [] };

  const cust = await prisma.customer.create({
    data: {
      code: `${TAG}-CUST`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      district: "余杭区",
      town: "闲林街道",
      contactPhone: "13800000000",
      createdById: sales.id,
      updatedById: sales.id,
      ownerUserId: sales.id
    }
  });
  testCustomerId = cust.id;

  // contract=10000, invoice=6000(5 天前开票), payment=3000 → 开票率 60, 回款率 50, 未回款 3000
  const ctr = await makeContract(cust.id, cust.name, sales.id, sales.id, 10000, "main");
  createdContractNos.push(ctr.contractNo);
  const inv = await makeIssuedInvoice(ctr.id, sales.id, 6000, "main", 5);
  await makeConfirmedPayment(inv.id, ctr.id, 3000, "main");
});

afterAll(async () => {
  if (!dbReachable) return;
  // 严格按 FK 反向顺序清理
  if (createdPaymentIds.length > 0) {
    await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
  }
  if (createdInvoiceIds.length > 0) {
    await prisma.invoiceAuditLog.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
  }
  if (createdContractNos.length > 0) {
    const ctrIds = (await prisma.contract.findMany({ where: { contractNo: { in: createdContractNos } }, select: { id: true } })).map((c) => c.id);
    if (ctrIds.length > 0) {
      await prisma.payment.deleteMany({ where: { contractId: { in: ctrIds } } });
    }
    await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
  }
  if (testCustomerId) {
    await prisma.customer.deleteMany({ where: { id: testCustomerId } });
  }
  if (salesUserId) {
    // 发票开具会给负责人自动发站内信 (Message), 删用户前必须先清消息, 否则 FK 拦
    await prisma.message.deleteMany({ where: { receiverUserId: salesUserId } });
    await prisma.user.deleteMany({ where: { id: salesUserId } });
  }
});

describe("GET /api/statistics/performance 路由", () => {
  it("默认 dimension=owner: 返回 ok({ rows, range })", async () => {
    if (!dbReachable || !salesUser) return;
    const j = await callPerformance("");
    expect(j.code).toBe(0);
    expect(Array.isArray(j.data.rows)).toBe(true);
    expect(j.data.range).toHaveProperty("from");
    expect(j.data.range).toHaveProperty("to");
  });

  it("非法 dimension → 400 VALIDATION_FAILED", async () => {
    if (!dbReachable || !salesUser) return;
    const j = await callPerformance("dimension=bogus");
    expect(j.code).toBe(400);
    expect(j.errorCode).toBe(ERROR_CODES.VALIDATION_FAILED);
  });

  it("limit=1 只回 1 行且 rank=1", async () => {
    if (!dbReachable || !salesUser) return;
    const j = await callPerformance("dimension=owner&limit=1");
    expect(j.code).toBe(0);
    expect(j.data.rows.length).toBe(1);
    expect(j.data.rows[0].rank).toBe(1);
  });

  it("preset=year: range.from = 当年 1 月 1 日", async () => {
    if (!dbReachable || !salesUser) return;
    const j = await callPerformance("preset=year");
    expect(j.code).toBe(0);
    const from = new Date(j.data.range.from);
    const now = new Date();
    expect(from.getFullYear()).toBe(now.getFullYear());
    expect(from.getMonth()).toBe(0);
    expect(from.getDate()).toBe(1);
  });
});

describe("getPerformanceRanking owner 维度 (专用 SALES 用户)", () => {
  it("开票率/回款率/未回款口径: contract=10000, invoice=6000, payment=3000", async () => {
    if (!dbReachable || !salesUser) return;
    const j = await callPerformance("dimension=owner");
    expect(j.code).toBe(0);
    // SALES 行级隔离: 只看到自己一行
    expect(j.data.rows.length).toBe(1);
    const row = j.data.rows[0]!;
    expect(row.key).toBe(salesUserId);
    expect(row.employeeNo).toBe(salesUser!.employeeNo);
    expect(row.contractCount).toBe(1);
    expect(row.contractAmount).toBe(10000);
    expect(row.invoiceAmount).toBe(6000);
    expect(row.paymentAmount).toBe(3000);
    expect(row.invoiceRate).toBe(60);
    expect(row.paymentRate).toBe(50);
    expect(row.unpaidAmount).toBe(3000);
    expect(row.rank).toBe(1);
  });
});

describe("getPerformanceRanking signer 维度", () => {
  it("key=userId + employeeNo, SALES 只看到自己的签订合同", async () => {
    if (!dbReachable || !salesUser) return;
    const j = await callPerformance("dimension=signer");
    expect(j.code).toBe(0);
    expect(j.data.rows.length).toBe(1);
    const row = j.data.rows[0]!;
    expect(row.key).toBe(salesUserId);
    expect(row.employeeNo).toBe(salesUser!.employeeNo);
    expect(row.contractAmount).toBe(10000);
  });
});

describe("getPerformanceRanking region 维度", () => {
  it("带 district/town/customerCount, 同一客户聚合到区域行", async () => {
    if (!dbReachable || !salesUser) return;
    const j = await callPerformance("dimension=region");
    expect(j.code).toBe(0);
    // SALES 行级隔离: 只有自己拥有的客户区域
    expect(j.data.rows.length).toBeGreaterThanOrEqual(1);
    const row = j.data.rows.find((r: { district: string | null }) => r.district === "余杭区");
    expect(row).toBeDefined();
    expect(row!.town).toBe("闲林街道");
    expect(row!.customerCount).toBe(1);
    expect(row!.contractAmount).toBe(10000);
    expect(row!.region).toBe("余杭区 闲林街道");
  });
});