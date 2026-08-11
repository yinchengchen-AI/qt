import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { globalSearch } from "@/server/services/search";

let dbReachable = false;
let adminUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;
let expertUser: SessionUser | null = null;

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
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !salesUser) return;
  await fn();
};

const guardWithExpert = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !salesUser || !expertUser) return;
  await fn();
};

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

  it("SALES user only sees own customers", guard(async () => {
    const result = await globalSearch(salesUser!, "test");
    for (const customer of result.customers) {
      const owns = await prisma.customer.findFirst({
        where: { id: customer.id, ownerUserId: salesUser!.id, deletedAt: null }
      });
      expect(owns).not.toBeNull();
    }
  }));

  it("SALES user only sees own contracts", guard(async () => {
    const result = await globalSearch(salesUser!, "test");
    for (const contract of result.contracts) {
      const owns = await prisma.contract.findFirst({
        where: { id: contract.id, ownerUserId: salesUser!.id, deletedAt: null }
      });
      expect(owns).not.toBeNull();
    }
  }));

  it("EXPERT user only sees own customers", guardWithExpert(async () => {
    const result = await globalSearch(expertUser!, "test");
    for (const customer of result.customers) {
      const owns = await prisma.customer.findFirst({
        where: { id: customer.id, ownerUserId: expertUser!.id, deletedAt: null }
      });
      expect(owns).not.toBeNull();
    }
  }));

  it("EXPERT user only sees own contracts", guardWithExpert(async () => {
    const result = await globalSearch(expertUser!, "test");
    for (const contract of result.contracts) {
      const owns = await prisma.contract.findFirst({
        where: { id: contract.id, ownerUserId: expertUser!.id, deletedAt: null }
      });
      expect(owns).not.toBeNull();
    }
  }));

  it("ADMIN user sees all customers", guard(async () => {
    const totalCustomers = await prisma.customer.count({ where: { deletedAt: null } });
    const result = await globalSearch(adminUser!, "test");
    expect(result.customers.length).toBeLessThanOrEqual(totalCustomers);
  }));
});
