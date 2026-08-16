// 全局搜索聚合 service 回归
//
// 覆盖:
//   1) 按客户名 / 信用代码 / 联系人电话 / 合同号 / 发票号 / 回款单号各命中一次
//   2) read-open: SALES 跨 owner 可见 (与列表页同口径, v0.18.4 Wave 3); ADMIN 全量
//   3) 1 字符 q 不查库返回空分组; 含 % 的 q 被转义不命中; 无命中返回全空分组
//   4) 软删除记录不出现
//   5) 运行时权限收窄: 无 READ 权限的组返回空分组且不查库
//
// DB 不可达时整组 skip. 数据带唯一 TAG 前缀,跑完自清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  ACTION,
  RESOURCE,
  ROLE_PERMISSIONS,
  _resetRuntimePermissionsForTests,
  setRuntimePermissions
} from "@/lib/permissions";
import { searchAll } from "@/server/services/search";

let dbReachable = false;
const TAG = `TEST-SEARCH-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;

// sales 名下的完整链路: 客户A → 合同A → 发票A / 回款A
// admin 名下的客户B(用于验证 read-open: SALES 也能搜到)
let salesCustomerId: string | null = null;
let adminCustomerId: string | null = null;
let contractId: string | null = null;
let invoiceId: string | null = null;
let paymentId: string | null = null;
let softDeletedCustomerId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const adminRow = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null, status: "ACTIVE" },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  const salesRow = await prisma.user.findFirst({
    where: { role: { code: "SALES" }, deletedAt: null, status: "ACTIVE" },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  if (!adminRow || !salesRow) {
    dbReachable = false;
    return;
  }
  adminUser = { ...adminRow, roleCode: "ADMIN", permissions: [] };
  salesUser = { ...salesRow, roleCode: "SALES", permissions: [] };

  // 客户A (sales 名下): 名称/信用代码/联系人电话都含 TAG 变体,便于分组断言
  const custA = await prisma.customer.create({
    data: {
      code: `${TAG}-A`,
      name: `${TAG}-企泰客户`,
      shortName: `${TAG}-企泰`,
      unifiedSocialCreditCode: `91330100${TAG.replace(/[^A-Z0-9]/gi, "X").slice(0, 10)}`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactName: `${TAG}-张三`,
      contactPhone: "13800000999",
      ownerUserId: salesRow.id,
      createdById: salesRow.id,
      updatedById: salesRow.id
    }
  });
  salesCustomerId = custA.id;

  // 客户B (admin 名下): read-open 后 SALES 搜索也应命中
  const custB = await prisma.customer.create({
    data: {
      code: `${TAG}-B`,
      name: `${TAG}-乙客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000888",
      ownerUserId: adminRow.id,
      createdById: adminRow.id,
      updatedById: adminRow.id
    }
  });
  adminCustomerId = custB.id;

  // 软删除客户 (sales 名下, 名称含 TAG): 不应出现在任何结果里
  const custDel = await prisma.customer.create({
    data: {
      code: `${TAG}-DEL`,
      name: `${TAG}-已删客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000777",
      ownerUserId: salesRow.id,
      createdById: salesRow.id,
      updatedById: salesRow.id,
      deletedAt: new Date()
    }
  });
  softDeletedCustomerId = custDel.id;

  const contract = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-HT-001`,
      customerId: custA.id,
      customerName: custA.name,
      title: `${TAG}-安全评价合同`,
      serviceType: "OTHER",
      signDate: new Date(),
      startDate: new Date(),
      endDate: new Date(Date.now() + 365 * 86400_000),
      totalAmount: 10000,
      taxRate: 0.06,
      taxAmount: Number((10000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((10000 / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: salesRow.id,
      signerId: salesRow.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: salesRow.id,
      updatedById: salesRow.id
    }
  });
  contractId = contract.id;

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNo: `${TAG}-FP-001`,
      contractId: contract.id,
      customerId: custA.id,
      customerName: custA.name,
      invoiceType: "VAT_SPECIAL",
      amount: 1000,
      taxRate: 0.06,
      taxAmount: Number((1000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((1000 / 1.06).toFixed(2)),
      applyDate: new Date(),
      titleType: "COMPANY",
      titleName: custA.name,
      status: "ISSUED",
      applicantUserId: salesRow.id,
      attachments: [],
      createdById: salesRow.id,
      updatedById: salesRow.id
    }
  });
  invoiceId = invoice.id;

  const payment = await prisma.payment.create({
    data: {
      paymentNo: `${TAG}-SK-001`,
      customerId: custA.id,
      contractId: contract.id,
      invoiceId: invoice.id,
      amount: 1000,
      receivedAt: new Date(),
      method: "BANK_TRANSFER",
      bankRefNo: `${TAG}-REF-001`,
      status: "CONFIRMED",
      recorderUserId: salesRow.id,
      createdById: salesRow.id,
      updatedById: salesRow.id
    }
  });
  paymentId = payment.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  if (paymentId) await prisma.payment.delete({ where: { id: paymentId } }).catch(() => {});
  if (invoiceId) await prisma.invoice.delete({ where: { id: invoiceId } }).catch(() => {});
  if (contractId) await prisma.contract.delete({ where: { id: contractId } }).catch(() => {});
  for (const id of [salesCustomerId, adminCustomerId, softDeletedCustomerId]) {
    if (id) await prisma.customer.delete({ where: { id } }).catch(() => {});
  }
});

describe("searchAll 聚合搜索", () => {
  it("按客户名命中 customers 组", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, `${TAG}-企泰客户`);
    expect(r.customers.total).toBeGreaterThanOrEqual(1);
    expect(r.customers.items.some((c) => c.id === salesCustomerId)).toBe(true);
  });

  it("按统一社会信用代码命中 customers 组", async () => {
    if (!dbReachable || !adminUser) return;
    const cust = await prisma.customer.findUnique({ where: { id: salesCustomerId! } });
    const r = await searchAll(adminUser, cust!.unifiedSocialCreditCode!);
    expect(r.customers.items.some((c) => c.id === salesCustomerId)).toBe(true);
  });

  it("按联系人电话命中 customers 组", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, "13800000999");
    expect(r.customers.items.some((c) => c.id === salesCustomerId)).toBe(true);
  });

  it("按合同号命中 contracts 组", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, `${TAG}-HT-001`);
    expect(r.contracts.items.some((c) => c.id === contractId)).toBe(true);
  });

  it("按发票号命中 invoices 组且金额为 string", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, `${TAG}-FP-001`);
    const hit = r.invoices.items.find((i) => i.id === invoiceId);
    expect(hit).toBeDefined();
    expect(typeof hit!.amount).toBe("string");
  });

  it("按回款单号命中 payments 组且带出客户名", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, `${TAG}-SK-001`);
    const hit = r.payments.items.find((p) => p.id === paymentId);
    expect(hit).toBeDefined();
    expect(hit!.customerName).toContain(TAG);
  });

  it("SALES 跨 owner 可见 (read-open, 与列表页同口径)", async () => {
    if (!dbReachable || !salesUser) return;
    const r = await searchAll(salesUser, TAG);
    expect(r.customers.items.some((c) => c.id === salesCustomerId)).toBe(true);
    // read-open: admin 名下客户对 SALES 同样可见 (v0.18.4 Wave 3 权限改造)
    expect(r.customers.items.some((c) => c.id === adminCustomerId)).toBe(true);
    // 乙客户名检索: SALES 视角也能命中
    const r2 = await searchAll(salesUser, `${TAG}-乙客户`);
    expect(r2.customers.total).toBeGreaterThanOrEqual(1);
    expect(r2.customers.items.some((c) => c.id === adminCustomerId)).toBe(true);
  });

  it("ADMIN 全量可见", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, TAG);
    expect(r.customers.items.some((c) => c.id === adminCustomerId)).toBe(true);
  });

  it("1 字符关键字不查库, 返回全空分组", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, "企");
    expect(r.customers.total).toBe(0);
    expect(r.contracts.total).toBe(0);
    expect(r.invoices.total).toBe(0);
    expect(r.payments.total).toBe(0);
  });

  it("LIKE 通配符 % 被转义, 不会匹配全部", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, "%%");
    expect(r.customers.total).toBe(0);
  });

  it("软删除记录不出现", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, `${TAG}-已删客户`);
    expect(r.customers.items.some((c) => c.id === softDeletedCustomerId)).toBe(false);
    expect(r.customers.total).toBe(0);
  });

  it("无命中返回全空分组而非报错", async () => {
    if (!dbReachable || !adminUser) return;
    const r = await searchAll(adminUser, `${TAG}-不存在的关键字`);
    expect(r.customers.total).toBe(0);
    expect(r.contracts.items).toEqual([]);
  });

  it("运行时权限被收窄后, 无 READ 权限的组返回空分组 (不查库)", async () => {
    if (!dbReachable || !salesUser) return;
    // SALES 默认权限剔除 INVOICE 资源的 READ action, 模拟 admin 在 /admin/roles 收窄
    const narrowed = ROLE_PERMISSIONS.SALES.map((p) =>
      p.resource === RESOURCE.INVOICE
        ? { ...p, actions: p.actions.filter((a) => a !== ACTION.READ) }
        : p
    );
    try {
      setRuntimePermissions("SALES", narrowed);
      const r = await searchAll(salesUser, TAG);
      // 发票组被门禁: 即使 sales 名下有命中发票也返回空
      expect(r.invoices.total).toBe(0);
      expect(r.invoices.items).toEqual([]);
      // 客户组不受影响, 仍正常命中
      expect(r.customers.items.some((c) => c.id === salesCustomerId)).toBe(true);
    } finally {
      _resetRuntimePermissionsForTests();
    }
  });
});
