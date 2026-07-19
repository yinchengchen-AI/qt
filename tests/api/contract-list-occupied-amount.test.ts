// listContracts 返回 occupiedAmount (R-08 额度占用口径) 测试
//
// 背景: 开票新建页需要前端提示"剩余可开票额度", 口径必须与服务端 createInvoice 的
//       R-08 校验一致 (INVOICE_LIMIT_COUNTED_STATUSES: DRAFT/PENDING_FINANCE/ISSUED/RED_FLUSHED,
//       红冲对净 0 由负票自然抵消), 不能复用 invoicedAmount 展示口径 (ISSUED+RED_FLUSHED).
//
// 覆盖:
//   1) DRAFT 发票计入 occupiedAmount, 但不计入 invoicedAmount
//   2) ISSUED 发票同时计入 occupiedAmount 与 invoicedAmount
//   3) VOIDED 发票两者都不计入
//
// DB 不可达时整组 skip. 数据用 unique TAG 前缀, afterAll 自清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { listContracts } from "@/server/services/contract";

let dbReachable = false;
const TAG = `TEST-CTR-OCCUPIED-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let customerId: string | null = null;
let contractId: string | null = null;
const invoiceIds: string[] = [];

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
  if (!adminRow) return;
  adminUser = { ...adminRow, roleCode: "ADMIN", permissions: [] };

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
  customerId = cust.id;

  const contract = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-A`,
      customerId: cust.id,
      customerName: cust.name,
      title: `${TAG}-合同`,
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
      ownerUserId: adminUser.id,
      signerId: adminUser.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
  contractId = contract.id;

  // 三种状态各一张: DRAFT 1000 / ISSUED 2000 / VOIDED 3000
  const mkInvoice = (suffix: string, amount: number, status: string) =>
    prisma.invoice.create({
      data: {
        invoiceNo: `${TAG}-${suffix}`,
        contractId: contract.id,
        customerId: cust.id,
        customerName: cust.name,
        invoiceType: "VAT_SPECIAL",
        amount,
        taxRate: 0.06,
        taxAmount: Number((amount * 0.06 / 1.06).toFixed(2)),
        amountExcludingTax: Number((amount / 1.06).toFixed(2)),
        applyDate: new Date(),
        titleType: "COMPANY",
        titleName: cust.name,
        status,
        applicantUserId: adminUser!.id,
        attachments: [],
        createdById: adminUser!.id,
        updatedById: adminUser!.id
      }
    });

  invoiceIds.push((await mkInvoice("DRAFT", 1000, "DRAFT")).id);
  invoiceIds.push((await mkInvoice("ISSUED", 2000, "ISSUED")).id);
  invoiceIds.push((await mkInvoice("VOIDED", 3000, "VOIDED")).id);
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (invoiceIds.length) await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    if (contractId) await prisma.contract.deleteMany({ where: { id: contractId } });
    if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

describe("listContracts occupiedAmount (R-08 额度占用口径)", () => {
  it("DRAFT/ISSUED 计入 occupiedAmount, VOIDED 不计入", async () => {
    if (!dbReachable || !adminUser || !contractId) return;
    const result = await listContracts(adminUser, {
      page: 1,
      pageSize: 100,
      customerId: customerId!
    } as Parameters<typeof listContracts>[1]);
    const row = result.list.find((r) => r.id === contractId);
    expect(row).toBeDefined();
    // DRAFT 1000 + ISSUED 2000 = 3000; VOIDED 3000 不计
    expect(row?.occupiedAmount).toBe(3000);
  });

  it("invoicedAmount 展示口径只含 ISSUED, 与 occupiedAmount 区分", async () => {
    if (!dbReachable || !adminUser || !contractId) return;
    const result = await listContracts(adminUser, {
      page: 1,
      pageSize: 100,
      customerId: customerId!
    } as Parameters<typeof listContracts>[1]);
    const row = result.list.find((r) => r.id === contractId);
    expect(row).toBeDefined();
    // 仅 ISSUED 2000; DRAFT 不计 → 证明两个口径确实不同
    expect(row?.invoicedAmount).toBe(2000);
  });
});
