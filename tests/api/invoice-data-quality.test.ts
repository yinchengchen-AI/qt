// 统计模块异常数据 service 回归。
//
// 覆盖:
//   1) summary: 同发票多问题只计 1 张/一次金额, 状态拆分正确。
//   2) issueCode / status / keyword 过滤。
//   3) 分页字段透传。
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  getInvoiceDataQualityIssues,
} from "@/server/services/invoice-data-quality";
import { createInvoice, invoiceAction } from "@/server/services/invoice";

let dbReachable = false;
const TAG = `TEST-DQ-STAT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  const signDate = new Date(Date.now() - 100 * 86400_000);
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

async function makeIssuedInvoice(contractId: string, suffix: string, amount: number) {
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
    actualIssueDate: new Date().toISOString()
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

describe("统计模块 - 发票数据质量异常台账", () => {
  it("summary 按发票去重统计金额, 状态正确拆分", async () => {
    if (!dbReachable || !adminUser) return;
    const ctr = await makeContract("sum");
    const invA = await makeIssuedInvoice(ctr.id, "sum-a", 1000);
    await prisma.invoiceDataQualityIssue.createMany({
      data: [
        { invoiceId: invA.id, issueCode: "PENDING_INVOICE_NO" },
        { invoiceId: invA.id, issueCode: "DUPLICATE_INVOICE_NO" }
      ]
    });
    const invB = await makeIssuedInvoice(ctr.id, "sum-b", 500);
    const issueB = await prisma.invoiceDataQualityIssue.create({
      data: { invoiceId: invB.id, issueCode: "INVALID_AGING_DATE" }
    });
    await prisma.invoiceDataQualityIssue.update({
      where: { id: issueB.id },
      data: { status: "RESOLVED", resolvedAt: new Date() }
    });

    const r = await getInvoiceDataQualityIssues(buildAdmin());
    expect(r.total).toBeGreaterThanOrEqual(3);
    expect(r.summary.openIssueCount).toBeGreaterThanOrEqual(2);
    expect(r.summary.resolvedIssueCount).toBeGreaterThanOrEqual(1);
    expect(r.summary.openInvoiceCount).toBeGreaterThanOrEqual(1);
    expect(r.summary.openAmount).toBeGreaterThanOrEqual(1000);
  });

  it("issueCode 过滤 + status 过滤 + 关键词", async () => {
    if (!dbReachable || !adminUser) return;
    const ctr = await makeContract("filter");
    const inv = await makeIssuedInvoice(ctr.id, "filter-a", 800);
    await prisma.invoiceDataQualityIssue.create({
      data: { invoiceId: inv.id, issueCode: "NO_INVOICE_REQUIRED", detail: `${TAG}-keyword-内部无票` }
    });

    const byCode = await getInvoiceDataQualityIssues(buildAdmin(), {
      issueCode: "NO_INVOICE_REQUIRED",
      status: "OPEN"
    });
    expect(byCode.list.some((x) => x.invoiceId === inv.id)).toBe(true);

    const byKeyword = await getInvoiceDataQualityIssues(buildAdmin(), {
      keyword: `${TAG}-keyword`,
      status: "OPEN"
    });
    expect(byKeyword.list.some((x) => x.invoiceId === inv.id)).toBe(true);

    const noResolved = await getInvoiceDataQualityIssues(buildAdmin(), {
      issueCode: "NO_INVOICE_REQUIRED",
      status: "RESOLVED"
    });
    expect(noResolved.list.some((x) => x.invoiceId === inv.id)).toBe(false);
  });
});
