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
  getEmployeePerformance
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
  try {
    if (createdPaymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
    }
    if (createdInvoiceIds.length > 0) {
      await prisma.invoiceAuditLog.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdContractNos.length > 0) {
      await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
    }
    if (testCustomerId) {
      await prisma.customer.delete({ where: { id: testCustomerId } });
    }
  } catch {
    // ignore cleanup errors
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
  it("paymentAmount > invoiceAmount 时 unpaidAmount 不为负(clamp 到 0)", async () => {
    if (!dbReachable || !adminUser || !financeUser) return;
    const cust = testCustomerId!;
    // 全局 DB 已有其它合同/发票/回款, 不能用绝对值 0 断言, 改用 delta 法验证 clamp:
    //   1) 先抓 baseline (前置合同/发票已开, 没有预付款)
    //   2) 加一张 100 的发票 + 500 的预付款 → invoiceAmount +100, paymentAmount +500
    //   3) 后置 unpaidRaw = (prev.invoiceAmount + 100) - (prev.paymentAmount + 500)
    //      delta = +100 - +500 = -400, clamp 后基线 unpaidAmount 减少 400 (但不低于 0)
    //   4) 关键性质: 后置 unpaidAmount === max(0, 前置 unpaidAmount - 400)
    const ctr = await makeContract(cust, `${TAG}-客户`, adminUser.id, adminUser.id, 1000, "clamp-1");
    createdContractNos.push(ctr.contractNo);
    const before = await getOverview(buildAdmin(), {});
    await makeIssuedInvoice(ctr.id, adminUser.id, 100, "clamp-1", 5);
    const advance = await createPayment(buildFinance(), {
      contractId: ctr.id,
      amount: 500,
      receivedAt: new Date().toISOString(),
      method: "BANK_TRANSFER"
    });
    createdPaymentIds.push(advance.id);
    await paymentAction(buildFinance(), advance.id, { action: "confirm", bankRefNo: `${TAG}-ADV1` });

    const after = await getOverview(buildAdmin(), {});
    // 1. invoiceAmount 增加 100, paymentAmount 增加 500
    expect(after.invoiceAmount - before.invoiceAmount).toBeCloseTo(100, 2);
    expect(after.paymentAmount - before.paymentAmount).toBeCloseTo(500, 2);
    // 2. clamp 起效: 不为负
    expect(after.unpaidAmount).toBeGreaterThanOrEqual(0);
    // 3. unpaidAmount 不应超过前置 - 400 (clamp 上限)
    expect(after.unpaidAmount).toBeLessThanOrEqual(Math.max(0, before.unpaidAmount - 400 + 0.01));
    // 4. 若前置 unpaidAmount >= 400, 后置应减少 ~400; 若前置 < 400, 后置应为 0 (clamp)
    if (before.unpaidAmount >= 400) {
      expect(before.unpaidAmount - after.unpaidAmount).toBeCloseTo(400, 2);
    } else {
      expect(after.unpaidAmount).toBe(0);
    }
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
