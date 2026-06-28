// 回款创建校验回归
//
// 覆盖:
//   1) createPayment 拒绝 DRAFT / CLOSED 合同
//   2) createPayment 拒绝非 ISSUED 状态的发票（VOIDED / DRAFT）
//   3) createPayment 登记阶段即校验 R-11 / R-12 超额

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { createPayment } from "@/server/services/payment";
import { createInvoice, invoiceAction } from "@/server/services/invoice";

let dbReachable = false;
const TAG = `TEST-PAY-GUARD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdInvoiceIds: string[] = [];
const createdContractNos: string[] = [];
const createdPaymentIds: string[] = [];
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let financeUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "FINANCE" } | null = null;
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
      await prisma.payment.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdContractNos.length > 0) {
      await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
    }
    if (testCustomerId) {
      await prisma.customer.delete({ where: { id: testCustomerId } });
    }
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable) return;
  if (!adminUser || !financeUser || !testCustomerId) return;
  await fn();
};

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return { id: adminUser.id, employeeNo: adminUser.employeeNo, name: adminUser.name, email: adminUser.email, roleCode: "ADMIN", permissions: [] };
};
const buildFinance = (): SessionUser => {
  if (!financeUser) throw new Error("finance not bootstrapped");
  return { id: financeUser.id, employeeNo: financeUser.employeeNo, name: financeUser.name, email: financeUser.email, roleCode: "FINANCE", permissions: [] };
};

async function mkContract(totalAmount: string, suffix: string, status: "DRAFT" | "ACTIVE" | "CLOSED" = "ACTIVE") {
  if (!adminUser || !testCustomerId) throw new Error("setup not ready");
  const no = `${TAG}-${suffix}`;
  createdContractNos.push(no);
  return prisma.contract.create({
    data: {
      contractNo: no,
      customerId: testCustomerId,
      customerName: `${TAG}-客户`,
      title: `${TAG}-title-${suffix}`,
      serviceType: "OTHER",
      signDate: new Date("2026-01-01T00:00:00Z"),
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-12-31T00:00:00Z"),
      totalAmount,
      taxRate: "0.06",
      taxAmount: "0",
      amountExcludingTax: "0",
      paymentMethod: "LUMP_SUM",
      status,
      ownerUserId: adminUser.id,
      signerId: adminUser.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
}

// 把任意字符串映射成 20 位纯数字, 避免 issue 时 invoiceNo 撞号
function digits20(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = h >>> 0;
  return u.toString().padStart(10, "0").padEnd(20, "0").slice(-20);
}

async function mkInvoice(contractId: string, amount: number, suffix: string, issue = false) {
  const inv = await createInvoice(buildAdmin(), {
    contractId,
    invoiceNo: `${TAG}-INV-${suffix}`,
    invoiceType: "VAT_SPECIAL",
    amount,
    taxRate: 0.06,
    applyDate: new Date().toISOString(),
    titleType: "COMPANY",
    titleName: `${TAG}-抬头`,
    taxNo: "91330000123456789X",
    attachments: []
  });
  if (!inv) throw new Error("createInvoice returned null");
  createdInvoiceIds.push(inv.id);
  if (issue) {
    await invoiceAction(buildFinance(), inv.id, { action: "submit" });
    await invoiceAction(buildFinance(), inv.id, { action: "issue", invoiceNo: digits20(`${TAG}-ISSUE-${suffix}`), actualIssueDate: new Date().toISOString() });
    const planned = await prisma.payment.findFirst({ where: { invoiceId: inv.id, status: "PLANNED", deletedAt: null } });
    if (planned) createdPaymentIds.push(planned.id);
  }
  return inv;
}

describe("createPayment 合同状态校验", () => {
  it("DRAFT 合同 → 拒绝", guard(async () => {
    const c = await mkContract("100.00", "DRAFT-CT", "DRAFT");
    await expect(
      createPayment(buildAdmin(), { contractId: c.id, amount: 50, receivedAt: new Date().toISOString(), method: "BANK_TRANSFER" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));

  it("CLOSED 合同 → 拒绝", guard(async () => {
    const c = await mkContract("100.00", "CLOSED-CT", "CLOSED");
    await expect(
      createPayment(buildAdmin(), { contractId: c.id, amount: 50, receivedAt: new Date().toISOString(), method: "BANK_TRANSFER" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));
});

describe("createPayment 发票状态校验", () => {
  it("DRAFT 发票 → 拒绝", guard(async () => {
    const c = await mkContract("100.00", "INV-DRAFT");
    const inv = await mkInvoice(c.id, 50, "DRAFT", false);
    await expect(
      createPayment(buildAdmin(), { contractId: c.id, invoiceId: inv.id, amount: 50, receivedAt: new Date().toISOString(), method: "BANK_TRANSFER" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));

  it("VOIDED 发票 → 拒绝", guard(async () => {
    const c = await mkContract("100.00", "INV-VOID");
    const inv = await mkInvoice(c.id, 50, "VOID", true);
    await invoiceAction(buildFinance(), inv.id, { action: "void", reason: "测试作废" });
    await expect(
      createPayment(buildAdmin(), { contractId: c.id, invoiceId: inv.id, amount: 50, receivedAt: new Date().toISOString(), method: "BANK_TRANSFER" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));
});

describe("createPayment 金额前置校验", () => {
  it("超发票金额 → 拒绝 (PAYMENT_OVER_INVOICE)", guard(async () => {
    const c = await mkContract("1000.00", "OVER-INV");
    const inv = await mkInvoice(c.id, 50, "OVER", true);
    await expect(
      createPayment(buildAdmin(), { contractId: c.id, invoiceId: inv.id, amount: 60, receivedAt: new Date().toISOString(), method: "BANK_TRANSFER" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.PAYMENT_OVER_INVOICE });
  }));

  it("超合同总额 → 拒绝 (PAYMENT_OVER_CONTRACT)", guard(async () => {
    const c = await mkContract("50.00", "OVER-CT");
    await expect(
      createPayment(buildAdmin(), { contractId: c.id, amount: 60, receivedAt: new Date().toISOString(), method: "BANK_TRANSFER" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.PAYMENT_OVER_CONTRACT });
  }));
});
