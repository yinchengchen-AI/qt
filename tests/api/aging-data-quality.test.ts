// 应收账龄数据质量隔离回归。
//
// 覆盖:
//   1) OPEN 隔离问题会将发票移出主账龄桶, 金额进入 dataQualityExcluded。
//   2) RESOLVED 后重新进入主账龄口径。
//   3) byCustomer 维度同样排除 OPEN 问题行。
//
// DB 不可达时整组 skip, 数据用 TAG 前缀隔离, afterAll 自清理。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  getInvoiceAging,
  getAgingByCustomer,
} from "@/server/services/statistics";
import { createInvoice, invoiceAction } from "@/server/services/invoice";

let dbReachable = false;
const TAG = `TEST-DQ-AGING-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let financeUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "FINANCE" } | null = null;
let testCustomerId: string | null = null;
const createdContractNos: string[] = [];
const createdInvoiceIds: string[] = [];

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return { id: adminUser.id, employeeNo: adminUser.employeeNo, name: adminUser.name, email: adminUser.email, roleCode: "ADMIN", permissions: [] };
};

const buildFinance = (): SessionUser => {
  if (!financeUser) throw new Error("finance not bootstrapped");
  return { id: financeUser.id, employeeNo: financeUser.employeeNo, name: financeUser.name, email: financeUser.email, roleCode: "FINANCE", permissions: [] };
};

async function makeContract(suffix: string) {
  const signDate = new Date(Date.now() - 120 * 86400_000);
  const contractNo = `${TAG}-CTR-${suffix}`;
  const ctr = await prisma.contract.create({
    data: {
      contractNo,
      customerId: testCustomerId!,
      customerName: `${TAG}-客户`,
      title: `${TAG}-title-${suffix}`,
      serviceType: "OTHER",
      signDate,
      startDate: signDate,
      endDate: new Date(Date.now() + 365 * 86400_000),
      totalAmount: 10000,
      taxRate: 0.06,
      taxAmount: 566.04,
      amountExcludingTax: 9433.96,
      paymentMethod: "LUMP_SUM",
      installmentPlan: [],
      status: "ACTIVE",
      ownerUserId: adminUser!.id,
      signerId: adminUser!.id,
      attachments: [],
      createdById: adminUser!.id,
      updatedById: adminUser!.id
    }
  });
  createdContractNos.push(contractNo);
  return ctr;
}

async function makeIssuedInvoice(contractId: string, suffix: string, daysAgo = 100) {
  const created = await createInvoice(buildAdmin(), {
    contractId,
    invoiceNo: `${TAG}-INV-${suffix}`,
    invoiceType: "VAT_SPECIAL",
    amount: 1000,
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
    actualIssueDate: new Date(Date.now() - daysAgo * 86400_000).toISOString()
  });
  await prisma.invoice.update({
    where: { id: created.id },
    data: { dueDate: new Date(Date.now() - daysAgo * 86400_000) }
  });
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
    await prisma.invoiceDataQualityIssue.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
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
});

describe("应收账龄数据质量隔离", () => {
  it("OPEN 问题发票不进入主桶, 但进入 dataQualityExcluded", async () => {
    if (!dbReachable || !adminUser) return;
    const ctr = await makeContract("dq-open");
    const inv = await makeIssuedInvoice(ctr.id, "dq-open");
    await prisma.invoiceDataQualityIssue.create({
      data: { invoiceId: inv.id, issueCode: "PENDING_INVOICE_NO", status: "OPEN" }
    });

    const r = await getInvoiceAging(buildAdmin());
    expect(r.rows.find((x) => x.invoiceId === inv.id)).toBeUndefined();
    expect(r.summary.dataQualityExcludedInvoiceCount).toBeGreaterThanOrEqual(1);
    expect(r.dataQualityExcluded.amount).toBeGreaterThanOrEqual(1000);
    expect(r.dataQualityExcluded.byCode.PENDING_INVOICE_NO).toBeDefined();
  });

  it("RESOLVED 后重新进入主账龄口径", async () => {
    if (!dbReachable || !adminUser) return;
    const ctr = await makeContract("dq-resolved");
    const inv = await makeIssuedInvoice(ctr.id, "dq-resolved");
    const issue = await prisma.invoiceDataQualityIssue.create({
      data: { invoiceId: inv.id, issueCode: "INVALID_AGING_DATE", status: "OPEN" }
    });
    await prisma.invoiceDataQualityIssue.update({
      where: { id: issue.id },
      data: { status: "RESOLVED", resolvedAt: new Date() }
    });

    const r = await getInvoiceAging(buildAdmin());
    expect(r.rows.find((x) => x.invoiceId === inv.id)).toBeDefined();
  });

  it("byCustomer 维度同样排除 OPEN 问题发票", async () => {
    if (!dbReachable || !adminUser) return;
    const ctr = await makeContract("dq-dim");
    const inv = await makeIssuedInvoice(ctr.id, "dq-dim");
    await prisma.invoiceDataQualityIssue.create({
      data: { invoiceId: inv.id, issueCode: "NO_INVOICE_REQUIRED", status: "OPEN" }
    });

    const rows = await getAgingByCustomer(buildAdmin(), { basis: "due", limit: 200 });
    const hit = rows.find((x) => x.key === testCustomerId);
    expect(hit).toBeUndefined();
  });
});
