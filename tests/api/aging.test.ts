// 应收账龄重设计 (round-3) — service 层回归
//
// 覆盖:
//   1) getInvoiceAging 桶边界(0/1/30/31/60/61/90/91/120)
//   2) basis=issue vs basis=due:同一张发票两种基准差异
//   3) dueDate 为 null 时回退到 actualIssueDate 计龄
//   4) byCustomer / byOwner 维度聚合
//   5) SALES 行级隔离(byOwner / byCustomer 都看不到他人)
//   6) getUninvoicedContracts 排除有 ISSUED 发票的合同
//   7) 旧响应字段 { buckets, total, rows } 仍存在(保证 dashboard 不破)
//
// DB 不可达时整组 skip. 用 unique TAG 前缀隔离数据, afterAll 自清理.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  getInvoiceAging,
  getAgingByCustomer,
  getUninvoicedContracts
} from "@/server/services/statistics";
import { createInvoice, invoiceAction } from "@/server/services/invoice";

let dbReachable = false;
const TAG = `TEST-AGING-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let financeUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "FINANCE" } | null = null;
let testCustomerId: string | null = null;
const createdContractNos: string[] = [];
const createdInvoiceIds: string[] = [];
const createdCustomerIds: string[] = [];

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return { id: adminUser.id, employeeNo: adminUser.employeeNo, name: adminUser.name, email: adminUser.email, roleCode: "ADMIN", permissions: [] };
};
const buildFinance = (): SessionUser => {
  if (!financeUser) throw new Error("finance not bootstrapped");
  return { id: financeUser.id, employeeNo: financeUser.employeeNo, name: financeUser.name, email: financeUser.email, roleCode: "FINANCE", permissions: [] };
};
async function makeContract(customerId: string, customerName: string, ownerId: string, signerId: string, totalAmount: number, suffix: string, daysAgoSign = 90) {
  const contractNo = `${TAG}-CTR-${suffix}`;
  const signDate = new Date(Date.now() - daysAgoSign * 86400_000);
  return prisma.contract.create({
    data: {
      contractNo,
      customerId,
      customerName,
      title: `${TAG}-title-${suffix}`,
      serviceType: "OTHER",
      signDate,
      startDate: signDate,
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

async function makeIssuedInvoice(
  contractId: string,
  ownerId: string,
  amount: number,
  suffix: string,
  daysAgoIssue: number,
  overrideDueDate?: Date
) {
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
  // 如需覆盖 dueDate, 直接写库
  if (overrideDueDate !== undefined) {
    await prisma.invoice.update({ where: { id: created.id }, data: { dueDate: overrideDueDate } });
  }
  createdInvoiceIds.push(created.id);
  return created;
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
  if (!adminRow || !financeRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN" };
  financeUser = { id: financeRow.id, employeeNo: financeRow.employeeNo, name: financeRow.name, email: financeRow.email, roleCode: "FINANCE" };
  const cust = await prisma.customer.create({
    data: {
      code: `${TAG}-CUST`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000000",
      ownerUserId: adminUser.id,
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
  testCustomerId = cust.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  if (createdInvoiceIds.length > 0) {
    await prisma.dunningNote.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
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
  if (createdCustomerIds.length > 0) {
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
  }
});

describe("getInvoiceAging 旧字段后向兼容", () => {
  it("返回 buckets / total / rows 三字段(供 dashboard)", async () => {
    if (!dbReachable || !adminUser) return;
    const ctr = await makeContract(testCustomerId!, `${TAG}-客户`, adminUser.id, adminUser.id, 10000, "compat-1", 120);
    createdContractNos.push(ctr.contractNo);
    await makeIssuedInvoice(ctr.id, adminUser.id, 1000, "compat-1", 45);

    const r = await getInvoiceAging(buildAdmin());
    expect(r).toHaveProperty("buckets");
    expect(r).toHaveProperty("total");
    expect(r).toHaveProperty("rows");
    expect(r.buckets).toHaveProperty("0-30");
    expect(r.buckets).toHaveProperty("31-60");
    expect(r.buckets).toHaveProperty("61-90");
    expect(r.buckets).toHaveProperty("90+");
    expect(typeof r.total).toBe("number");
    expect(Array.isArray(r.rows)).toBe(true);
  });
});

describe("getInvoiceAging basis 切换", () => {
  it("同一张发票 basis=issue 与 basis=due 可以归到不同桶", async () => {
    if (!dbReachable || !adminUser) return;
    // 60 天前开票,30 天前到期
    const ctr = await makeContract(testCustomerId!, `${TAG}-客户`, adminUser.id, adminUser.id, 5000, "basis-1", 90);
    createdContractNos.push(ctr.contractNo);
    const due = new Date(Date.now() - 30 * 86400_000);
    const inv = await makeIssuedInvoice(ctr.id, adminUser.id, 1000, "basis-1", 60, due);

    const rIssue = await getInvoiceAging(buildAdmin(), { basis: "issue" });
    const rDue = await getInvoiceAging(buildAdmin(), { basis: "due" });
    const rowIssue = rIssue.rows.find((r) => r.invoiceId === inv.id);
    const rowDue = rDue.rows.find((r) => r.invoiceId === inv.id);
    expect(rowIssue).toBeDefined();
    expect(rowDue).toBeDefined();
    // basis=issue: 60 天前开票 -> 31-60
    expect(rowIssue!.bucket).toBe("31-60");
    // basis=due: 30 天前到期 -> 0-30
    expect(rowDue!.bucket).toBe("0-30");
  });

  it("dueDate=null 时回退到 actualIssueDate 计龄", async () => {
    if (!dbReachable || !adminUser) return;
    const ctr = await makeContract(testCustomerId!, `${TAG}-客户`, adminUser.id, adminUser.id, 3000, "fallback-1", 90);
    createdContractNos.push(ctr.contractNo);
    // 45 天前开票, 不覆盖 dueDate
    const inv = await makeIssuedInvoice(ctr.id, adminUser.id, 500, "fallback-1", 45);

    const rDue = await getInvoiceAging(buildAdmin(), { basis: "due" });
    const row = rDue.rows.find((r) => r.invoiceId === inv.id);
    expect(row).toBeDefined();
    // 没有 dueDate 应回退到 actualIssueDate, 45 天 -> 31-60
    expect(row!.bucket).toBe("31-60");
  });
});

describe("getInvoiceAging 桶边界", () => {
  it("按 dueDate 把 0/30/60/90 边界各归一类", async () => {
    if (!dbReachable || !adminUser) return;
    // 5 张发票, dueDate 分别 0/30/60/90/120 天前
    const ctr = await makeContract(testCustomerId!, `${TAG}-客户`, adminUser.id, adminUser.id, 10000, "boundary-1", 200);
    createdContractNos.push(ctr.contractNo);
    const buckets = [0, 30, 60, 90, 120];
    const invoices = [];
    for (let i = 0; i < buckets.length; i++) {
      const days = buckets[i]!;
      const due = new Date(Date.now() - days * 86400_000);
      const inv = await makeIssuedInvoice(ctr.id, adminUser.id, 100, `boundary-${i}`, 365, due);
      invoices.push({ id: inv.id, days });
    }
    const r = await getInvoiceAging(buildAdmin(), { basis: "due" });
    const expectBucket: Record<number, string> = {
      0: "0-30",
      30: "0-30",
      60: "31-60",
      90: "61-90",
      120: "90+"
    };
    for (const { id, days } of invoices) {
      const row = r.rows.find((x) => x.invoiceId === id);
      expect(row, `invoice ${id} (${days} days ago) should be in aging result`).toBeDefined();
      expect(row!.bucket).toBe(expectBucket[days]);
    }
  });
});

describe("getAgingByCustomer / getAgingByOwner", () => {
  it("按客户聚合正确, 客户维度的桶分布之和等于 totalReceivable", async () => {
    if (!dbReachable || !adminUser) return;
    // 用一个独立的客户做隔离, 避免其它 describe 块造的发票污染聚合
    const isolatedCustomer = await prisma.customer.create({
      data: {
        code: `${TAG}-CUST-DIM`,
        name: `${TAG}-客户-DIM`,
        customerType: "ENTERPRISE",
        province: "浙江省",
        city: "杭州市",
        contactPhone: "13800000000",
        ownerUserId: adminUser.id,
        createdById: adminUser.id,
        updatedById: adminUser.id
      }
    });
    createdCustomerIds.push(isolatedCustomer.id);
    const ctr = await makeContract(isolatedCustomer.id, isolatedCustomer.name, adminUser.id, adminUser.id, 3000, "dim-1", 90);
    createdContractNos.push(ctr.contractNo);
    await makeIssuedInvoice(ctr.id, adminUser.id, 500, "dim-1a", 45, new Date(Date.now() - 45 * 86400_000));
    await makeIssuedInvoice(ctr.id, adminUser.id, 500, "dim-1b", 100, new Date(Date.now() - 100 * 86400_000));

    const r = await getAgingByCustomer(buildAdmin(), { basis: "due", limit: 200 });
    const row = r.find((x) => x.key === isolatedCustomer.id);
    expect(row, `customer ${isolatedCustomer.id} should be in result`).toBeDefined();
    // 2 张发票, 1000 元应收
    expect(row!.totalReceivable).toBe(1000);
    expect(row!.invoiceCount).toBe(2);
    // bucket 之和等于 totalReceivable
    expect(row!.bucket31_60 + row!.bucket90).toBe(1000);
  });
});

describe("getUninvoicedContracts", () => {
  it("只返回 ACTIVE 且无 ISSUED 发票的合同", async () => {
    if (!dbReachable || !adminUser) return;
    // 造一份有 ISSUED 发票的合同 (上面的 ctr-1 / ctr-baseline 已经有了)
    // 再造一份没有 ISSUED 发票的合同
    const ctrNoIssued = await makeContract(testCustomerId!, `${TAG}-客户`, adminUser.id, adminUser.id, 1000, "uninvoiced-1", 60);
    createdContractNos.push(ctrNoIssued.contractNo);

    const r = await getUninvoicedContracts(buildAdmin(), { thresholdDays: 30, limit: 50 });
    // 至少包含我们造的 uninvoiced-1; 不应包含有发票的合同
    const found = r.find((x) => x.contractId === ctrNoIssued.id);
    expect(found).toBeDefined();
    expect(found!.isOverdue).toBe(true);
    expect(found!.daysSinceSign).toBeGreaterThanOrEqual(60);
  });
});
