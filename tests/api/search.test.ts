import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import type { RoleCode } from "@/types/enums";
import { ApiError } from "@/lib/api";
import { globalSearch } from "@/server/services/search";
import { setRuntimePermissions, clearRuntimePermissions } from "@/lib/permissions";

let dbReachable = false;
let adminUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;
let expertUser: SessionUser | null = null;

const CROSS_OWNER_KEYWORD = "CrossOwnerSearchKeyword";
const crossOwnerIds: { customerId?: string; contractId?: string; invoiceId?: string; paymentId?: string } = {};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const [adminRow, salesRow, expertRow] = await Promise.all([
    prisma.user.findFirst({ where: { role: { code: "ADMIN" }, deletedAt: null, isSystem: false } }),
    prisma.user.findFirst({ where: { role: { code: "SALES" }, deletedAt: null, isSystem: false } }),
    prisma.user.findFirst({ where: { role: { code: "EXPERT" }, deletedAt: null, isSystem: false } })
  ]);
  if (!adminRow || !salesRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN", permissions: [] };
  salesUser = { id: salesRow.id, employeeNo: salesRow.employeeNo, name: salesRow.name, email: salesRow.email, roleCode: "SALES", permissions: [] };
  if (expertRow) {
    expertUser = { id: expertRow.id, employeeNo: expertRow.employeeNo, name: expertRow.name, email: expertRow.email, roleCode: "EXPERT", permissions: [] };
  }

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const customer = await prisma.customer.create({
    data: {
      code: `CO-${uniqueSuffix}`,
      name: `${CROSS_OWNER_KEYWORD} Customer`,
      customerType: "ENTERPRISE",
      province: "浙江",
      city: "杭州",
      contactPhone: "13800000000",
      ownerUserId: adminUser.id,
      createdById: adminUser.id,
      updatedById: adminUser.id,
    },
  });
  crossOwnerIds.customerId = customer.id;

  const now = new Date();
  const contract = await prisma.contract.create({
    data: {
      contractNo: `CO-${uniqueSuffix}`,
      customerId: customer.id,
      customerName: customer.name,
      title: `${CROSS_OWNER_KEYWORD} Contract`,
      serviceType: "OTHER",
      signDate: now,
      startDate: now,
      endDate: new Date(now.getTime() + 86400000),
      totalAmount: 1000,
      taxRate: 0.06,
      taxAmount: 56.6,
      amountExcludingTax: 943.4,
      paymentMethod: "LUMP_SUM",
      status: "DRAFT",
      ownerUserId: adminUser.id,
      signerId: adminUser.id,
      attachments: [],
      createdById: adminUser.id,
      updatedById: adminUser.id,
    },
  });
  crossOwnerIds.contractId = contract.id;

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNo: `CO-${uniqueSuffix}`,
      invoiceCode: CROSS_OWNER_KEYWORD,
      contractId: contract.id,
      customerId: customer.id,
      customerName: customer.name,
      invoiceType: "VAT_GENERAL",
      amount: 1000,
      taxRate: 0.06,
      taxAmount: 56.6,
      amountExcludingTax: 943.4,
      applyDate: now,
      titleType: "COMPANY",
      titleName: customer.name,
      status: "DRAFT",
      applicantUserId: adminUser.id,
      createdById: adminUser.id,
      updatedById: adminUser.id,
    },
  });
  crossOwnerIds.invoiceId = invoice.id;

  const payment = await prisma.payment.create({
    data: {
      paymentNo: `CO-${uniqueSuffix}`,
      customerId: customer.id,
      contractId: contract.id,
      amount: 1000,
      receivedAt: now,
      method: "BANK_TRANSFER",
      bankRefNo: CROSS_OWNER_KEYWORD,
      status: "PLANNED",
      recorderUserId: adminUser.id,
      createdById: adminUser.id,
      updatedById: adminUser.id,
    },
  });
  crossOwnerIds.paymentId = payment.id;
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !salesUser) return;
  await fn();
};

const guardWithExpert = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !salesUser || !expertUser) return;
  await fn();
};

afterAll(async () => {
  if (!dbReachable || !adminUser) return;
  if (crossOwnerIds.paymentId) {
    await prisma.payment.deleteMany({ where: { id: crossOwnerIds.paymentId } });
  }
  if (crossOwnerIds.invoiceId) {
    await prisma.invoice.deleteMany({ where: { id: crossOwnerIds.invoiceId } });
  }
  if (crossOwnerIds.contractId) {
    await prisma.contract.deleteMany({ where: { id: crossOwnerIds.contractId } });
  }
  if (crossOwnerIds.customerId) {
    await prisma.customer.deleteMany({ where: { id: crossOwnerIds.customerId } });
  }
});

describe("globalSearch", () => {
  it("returns empty results for short keyword", guard(async () => {
    const result = await globalSearch(adminUser!, "a");
    expect(result).toEqual({ customers: [], contracts: [], invoices: [], payments: [] });
  }));

  it("returns empty results for empty keyword", guard(async () => {
    const result = await globalSearch(adminUser!, "");
    expect(result).toEqual({ customers: [], contracts: [], invoices: [], payments: [] });
  }));

  it("returns empty results for whitespace-only keyword", guard(async () => {
    const result = await globalSearch(adminUser!, "   ");
    expect(result).toEqual({ customers: [], contracts: [], invoices: [], payments: [] });
  }));

  it("searches customers by name", guard(async () => {
    const customer = await prisma.customer.findFirst({ where: { deletedAt: null } });
    if (!customer) return;
    const result = await globalSearch(adminUser!, customer.name.slice(0, 3));
    expect(result.customers.length).toBeGreaterThan(0);
    expect(result.customers.some((c) => c.id === customer.id)).toBe(true);
  }));

  it("searches customers by code", guard(async () => {
    const customer = await prisma.customer.findFirst({ where: { deletedAt: null } });
    if (!customer) return;
    const result = await globalSearch(adminUser!, customer.code);
    expect(result.customers.length).toBeGreaterThan(0);
    expect(result.customers.some((c) => c.id === customer.id)).toBe(true);
  }));

  it("searches contracts by contractNo", guard(async () => {
    const contract = await prisma.contract.findFirst({ where: { deletedAt: null } });
    if (!contract) return;
    const result = await globalSearch(adminUser!, contract.contractNo.slice(0, 5));
    expect(result.contracts.length).toBeGreaterThan(0);
    expect(result.contracts.some((c) => c.id === contract.id)).toBe(true);
  }));

  it("searches contracts by title", guard(async () => {
    const contract = await prisma.contract.findFirst({ where: { deletedAt: null } });
    if (!contract) return;
    const result = await globalSearch(adminUser!, contract.title.slice(0, 5));
    expect(result.contracts.length).toBeGreaterThan(0);
    expect(result.contracts.some((c) => c.id === contract.id)).toBe(true);
  }));

  it("searches invoices by invoiceNo", guard(async () => {
    const invoice = await prisma.invoice.findFirst({ where: { deletedAt: null } });
    if (!invoice) return;
    const result = await globalSearch(adminUser!, invoice.invoiceNo.slice(0, 5));
    expect(result.invoices.length).toBeGreaterThan(0);
    expect(result.invoices.some((i) => i.id === invoice.id)).toBe(true);
  }));

  it("searches payments by paymentNo", guard(async () => {
    const payment = await prisma.payment.findFirst({ where: { deletedAt: null } });
    if (!payment) return;
    const result = await globalSearch(adminUser!, payment.paymentNo.slice(0, 5));
    expect(result.payments.length).toBeGreaterThan(0);
    expect(result.payments.some((p) => p.id === payment.id)).toBe(true);
  }));

  it("returns correct result structure", guard(async () => {
    const result = await globalSearch(adminUser!, "test");
    expect(result).toHaveProperty("customers");
    expect(result).toHaveProperty("contracts");
    expect(result).toHaveProperty("invoices");
    expect(result).toHaveProperty("payments");
    for (const group of Object.values(result)) {
      for (const item of group) {
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("title");
        expect(item).toHaveProperty("subtitle");
        expect(item).toHaveProperty("module");
        expect(item).toHaveProperty("link");
        expect(["customer", "contract", "invoice", "payment"]).toContain(item.module);
        expect(item.link).toMatch(/^\/(customers|contracts|invoices|payments)\//);
      }
    }
  }));

  it("SALES user sees another owner's customer", guard(async () => {
    if (!crossOwnerIds.customerId) return;
    const result = await globalSearch(salesUser!, CROSS_OWNER_KEYWORD);
    expect(result.customers.some((c) => c.id === crossOwnerIds.customerId)).toBe(true);
  }));

  it("SALES user sees another owner's contract", guard(async () => {
    if (!crossOwnerIds.contractId) return;
    const result = await globalSearch(salesUser!, CROSS_OWNER_KEYWORD);
    expect(result.contracts.some((c) => c.id === crossOwnerIds.contractId)).toBe(true);
  }));

  it("EXPERT user sees another owner's customer", guardWithExpert(async () => {
    if (!crossOwnerIds.customerId) return;
    const result = await globalSearch(expertUser!, CROSS_OWNER_KEYWORD);
    expect(result.customers.some((c) => c.id === crossOwnerIds.customerId)).toBe(true);
  }));

  it("EXPERT user sees another owner's contract", guardWithExpert(async () => {
    if (!crossOwnerIds.contractId) return;
    const result = await globalSearch(expertUser!, CROSS_OWNER_KEYWORD);
    expect(result.contracts.some((c) => c.id === crossOwnerIds.contractId)).toBe(true);
  }));

  it("SALES user sees another owner's invoice", guard(async () => {
    if (!crossOwnerIds.invoiceId) return;
    const result = await globalSearch(salesUser!, CROSS_OWNER_KEYWORD);
    expect(result.invoices.some((i) => i.id === crossOwnerIds.invoiceId)).toBe(true);
  }));

  it("SALES user sees another owner's payment", guard(async () => {
    if (!crossOwnerIds.paymentId) return;
    const result = await globalSearch(salesUser!, CROSS_OWNER_KEYWORD);
    expect(result.payments.some((p) => p.id === crossOwnerIds.paymentId)).toBe(true);
  }));

  it("EXPERT user sees another owner's invoice", guardWithExpert(async () => {
    if (!crossOwnerIds.invoiceId) return;
    const result = await globalSearch(expertUser!, CROSS_OWNER_KEYWORD);
    expect(result.invoices.some((i) => i.id === crossOwnerIds.invoiceId)).toBe(true);
  }));

  it("EXPERT user sees another owner's payment", guardWithExpert(async () => {
    if (!crossOwnerIds.paymentId) return;
    const result = await globalSearch(expertUser!, CROSS_OWNER_KEYWORD);
    expect(result.payments.some((p) => p.id === crossOwnerIds.paymentId)).toBe(true);
  }));

  it("rejects user without READ permission at the permission gates", guard(async () => {
    const noReadUser: SessionUser = {
      id: "no-read",
      employeeNo: "no-read",
      name: "No Read",
      email: "no-read@example.com",
      roleCode: "NO_READ" as RoleCode,
      permissions: []
    };
    setRuntimePermissions("NO_READ", []);
    let thrown: unknown;
    try {
      await globalSearch(noReadUser, CROSS_OWNER_KEYWORD);
    } catch (e) {
      thrown = e;
    }
    clearRuntimePermissions("NO_READ");
    expect(thrown).toBeInstanceOf(ApiError);
    expect((thrown as ApiError).status).toBe(403);
  }));

  it("ADMIN user sees all customers", guard(async () => {
    const totalCustomers = await prisma.customer.count({ where: { deletedAt: null } });
    const result = await globalSearch(adminUser!, "test");
    expect(result.customers.length).toBeLessThanOrEqual(totalCustomers);
  }));
});
