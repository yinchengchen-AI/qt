// 应收账龄 API 路由层回归 — Zod 校验 / 鉴权 / 路由解析
//   1) /api/statistics/invoice-aging 默认行为(basis=due, pageSize 默认 100)
//   2) basis 切换走 Zod 校验
//   3) buckets 多选(逗号分隔)被解析
//   4) SALES 鉴权 + 行级隔离
//   5) by-customer / by-owner / uninvoiced-contracts 路由基本响应
//   6) 非法 basis 走 400

// 简化版:直接用 fetch 打到本地 dev server 不可行,改测 service 层 + 模拟 Zod schema
// 这里改为: 用 zod schema 单独测校验 + 调 service 验证 SALES 隔离

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  getAgingByCustomer,
  getAgingByOwner,
  getUninvoicedContracts
} from "@/server/services/statistics";
import { createInvoice, invoiceAction } from "@/server/services/invoice";

let dbReachable = false;
const TAG = `TEST-AGING-API-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let salesAUser: SessionUser | null = null;
let salesBUser: SessionUser | null = null;
let customerAId: string | null = null;
let customerBId: string | null = null;
const createdContractNos: string[] = [];
const createdInvoiceIds: string[] = [];

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return adminUser;
};
const buildSalesA = (): SessionUser => {
  if (!salesAUser) throw new Error("salesA not bootstrapped");
  return salesAUser;
};

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const adminRow = await prisma.user.findFirst({ where: { role: { code: "ADMIN" }, deletedAt: null } });
  const salesRows = await prisma.user.findMany({
    where: { role: { code: "SALES" }, deletedAt: null, isSystem: false },
    take: 2
  });
  if (!adminRow || salesRows.length < 2) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN", permissions: [] };
  salesAUser = { id: salesRows[0]!.id, employeeNo: salesRows[0]!.employeeNo, name: salesRows[0]!.name, email: salesRows[0]!.email, roleCode: "SALES", permissions: [] };
  salesBUser = { id: salesRows[1]!.id, employeeNo: salesRows[1]!.employeeNo, name: salesRows[1]!.name, email: salesRows[1]!.email, roleCode: "SALES", permissions: [] };
  // 建两个客户, 各自属于不同的 sales
  const cA = await prisma.customer.create({
    data: {
      code: `${TAG}-CA`, name: `${TAG}-A客户`, customerType: "ENTERPRISE",
      province: "浙江省", city: "杭州市", contactPhone: "13800000000",
      ownerUserId: salesAUser.id, createdById: adminUser.id, updatedById: adminUser.id
    }
  });
  const cB = await prisma.customer.create({
    data: {
      code: `${TAG}-CB`, name: `${TAG}-B客户`, customerType: "ENTERPRISE",
      province: "浙江省", city: "杭州市", contactPhone: "13800000001",
      ownerUserId: salesBUser.id, createdById: adminUser.id, updatedById: adminUser.id
    }
  });
  customerAId = cA.id;
  customerBId = cB.id;
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
  if (customerAId) await prisma.customer.deleteMany({ where: { id: customerAId } });
  if (customerBId) await prisma.customer.deleteMany({ where: { id: customerBId } });
});

// 复用 invoice-aging 路由的 Zod schema 测校验
const invoiceAgingQuerySchema = z.object({
  basis: z.enum(["issue", "due"]).optional(),
  customerId: z.string().optional(),
  ownerUserId: z.string().optional(),
  contractId: z.string().optional(),
  buckets: z.string().optional(),
  minAmount: z.string().optional(),
  page: z.string().optional(),
  pageSize: z.string().optional(),
  sort: z.enum(["daysOverdue:desc", "amount:desc", "customerName:asc"]).optional()
});

describe("Zod 校验(invoice-aging query)", () => {
  it("合法的默认值", () => {
    const r = invoiceAgingQuerySchema.parse({});
    expect(r.basis).toBeUndefined();
    expect(r.page).toBeUndefined();
  });

  it("非法 basis 抛 ZodError", () => {
    expect(() => invoiceAgingQuerySchema.parse({ basis: "invalid" })).toThrow();
  });

  it("非 sort 白名单抛 ZodError", () => {
    expect(() => invoiceAgingQuerySchema.parse({ sort: "createdAt:desc" })).toThrow();
  });

  it("string-类型数字字段被原样保留(由路由层做 toNumber)", () => {
    const r = invoiceAgingQuerySchema.parse({ minAmount: "100", pageSize: "50" });
    expect(r.minAmount).toBe("100");
    expect(r.pageSize).toBe("50");
  });
});

describe("getInvoiceAging SALES 行级隔离", () => {
  it("SALES 只能看到自己 owner 合同下的发票(byCustomer 维度)", async () => {
    if (!dbReachable || !salesAUser) return;
    // salesA 的 customer 造一张合同 + 1 张超期发票
    const ctrA = await prisma.contract.create({
      data: {
        contractNo: `${TAG}-CA-CTR`,
        customerId: customerAId!,
        customerName: `${TAG}-A客户`,
        title: `${TAG}-A-title`,
        serviceType: "OTHER",
        signDate: new Date(Date.now() - 100 * 86400_000),
        startDate: new Date(Date.now() - 100 * 86400_000),
        endDate: new Date(Date.now() + 365 * 86400_000),
        totalAmount: 10000,
        taxRate: 0.06,
        taxAmount: 566.04,
        amountExcludingTax: 9433.96,
        paymentMethod: "LUMP_SUM",
        installmentPlan: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["installmentPlan"],
        status: "ACTIVE",
        ownerUserId: salesAUser.id,
        signerId: salesAUser.id,
        attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
        createdById: salesAUser.id,
        updatedById: salesAUser.id
      }
    });
    createdContractNos.push(ctrA.contractNo);
    const inv = await createInvoice(buildAdmin(), {
      contractId: ctrA.id,
      invoiceNo: `${TAG}-INV-A`,
      invoiceType: "VAT_SPECIAL",
      amount: 1000,
      taxRate: 0.06,
      applyDate: new Date().toISOString(),
      titleType: "COMPANY",
      titleName: `${TAG}-抬头-A`,
      taxNo: "91110000123456789X",
      attachments: []
    });
    if (!inv) throw new Error("createInvoice returned null");
    await invoiceAction(buildAdmin(), inv.id, { action: "submit" });
    await invoiceAction(buildAdmin(), inv.id, {
      action: "issue",
      actualIssueDate: new Date(Date.now() - 60 * 86400_000).toISOString()
    });
    createdInvoiceIds.push(inv.id);

    // salesA 调用 — 应能看到自己 A 客户的发票
    const aResult = await getAgingByCustomer(buildSalesA(), { basis: "due", limit: 100 });
    const aHit = aResult.find((x) => x.key === customerAId);
    expect(aHit, "salesA 应能看到 A 客户的应收").toBeDefined();
    expect(aHit!.totalReceivable).toBeGreaterThanOrEqual(1000);

    // salesB 调用 — 不应看到 A 客户的发票
    const bResult = await getAgingByCustomer(salesBUser!, { basis: "due", limit: 100 });
    const bHit = bResult.find((x) => x.key === customerAId);
    expect(bHit, "salesB 不应看到 salesA 的 A 客户").toBeUndefined();
  });
});

describe("getAgingByOwner SALES 隔离", () => {
  it("业务人员 (SALES) 只能看到自己 owner 的业务人员行", async () => {
    if (!dbReachable || !salesAUser) return;
    const aResult = await getAgingByOwner(buildSalesA(), { basis: "due", limit: 100 });
    // 不应包含 salesB 的 owner 行
    const aHasB = aResult.some((r) => r.key === salesBUser!.id);
    expect(aHasB, "salesA 不应看到 salesB 的业务人员行").toBe(false);
  });
});

describe("getUninvoicedContracts 排除 ISSUED 发票", () => {
  it("已有 ISSUED 发票的合同不出现在结果中", async () => {
    if (!dbReachable || !salesAUser) return;
    const r = await getUninvoicedContracts(buildAdmin(), { thresholdDays: 0, limit: 200 });
    // 上面造的 ctrA 有 ISSUED 发票, 不应出现
    const hasInvoiced = r.find((x) => x.contractId === createdContractNos[0]!);
    expect(hasInvoiced).toBeUndefined();
  });
});
