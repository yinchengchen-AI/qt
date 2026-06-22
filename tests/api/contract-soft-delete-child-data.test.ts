// 软删除合同：存在子数据时应拒绝
//
// 覆盖:
//   1) 合同有关联发票 → softDeleteContract 失败
//   2) 合同有关联回款 → softDeleteContract 失败
//   3) 合同有关联附件 → softDeleteContract 失败
//
// DB 不可达时整组 skip. 数据带唯一 TAG 前缀,跑完自清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { createContract, softDeleteContract } from "@/server/services/contract";

let dbReachable = false;
const TAG = `TEST-CONTRACT-DEL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let testCustomerId: string | null = null;
const createdContractIds: string[] = [];
const createdInvoiceIds: string[] = [];
const createdPaymentIds: string[] = [];
const createdAttachmentIds: string[] = [];

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
      status: "NEGOTIATING",
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
    if (createdInvoiceIds.length > 0) {
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdPaymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
    }
    if (createdAttachmentIds.length > 0) {
      await prisma.attachment.deleteMany({ where: { id: { in: createdAttachmentIds } } });
    }
    if (createdContractIds.length > 0) {
      await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
    }
    if (testCustomerId) {
      await prisma.customer.deleteMany({ where: { id: testCustomerId } });
    }
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !testCustomerId) return;
  await fn();
};

async function mkContract(suffix: string) {
  if (!adminUser || !testCustomerId) throw new Error("setup not ready");
  const c = await createContract(adminUser, {
    customerId: testCustomerId,
    contractNo: `${TAG}-${suffix}`,
    title: `${TAG}-title-${suffix}`,
    serviceType: "OTHER",
    signDate: "2026-01-01T00:00:00.000Z",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-12-31T00:00:00.000Z",
    totalAmount: 10000,
    taxRate: 0.06,
    paymentMethod: "LUMP_SUM",
    attachments: []
  });
  if (!c) throw new Error("createContract returned null");
  createdContractIds.push(c.id);
  return c;
}

describe("softDeleteContract 子数据拦截", () => {
  it("存在发票 → 拒绝删除", guard(async () => {
    const c = await mkContract("HAS-INVOICE");
    const inv = await prisma.invoice.create({
      data: {
        invoiceNo: `${TAG}-INV`,
        contractId: c.id,
        customerId: testCustomerId!,
        customerName: `${TAG}-客户`,
        invoiceType: "VAT_GENERAL",
        amount: 1000,
        taxRate: 0.06,
        taxAmount: 60,
        amountExcludingTax: 940,
        applyDate: new Date("2026-01-01T00:00:00Z"),
        titleType: "COMPANY",
        titleName: `${TAG}-抬头`,
        status: "DRAFT",
        applicantUserId: adminUser!.id,
        createdById: adminUser!.id,
        updatedById: adminUser!.id
      }
    });
    createdInvoiceIds.push(inv.id);
    await expect(softDeleteContract(adminUser!, c.id)).rejects.toMatchObject({
      errorCode: ERROR_CODES.ENTITY_IMMUTABLE
    });
  }));

  it("存在回款 → 拒绝删除", guard(async () => {
    const c = await mkContract("HAS-PAYMENT");
    const pay = await prisma.payment.create({
      data: {
        paymentNo: `${TAG}-PAY`,
        customerId: testCustomerId!,
        contractId: c.id,
        amount: 1000,
        receivedAt: new Date("2026-01-01T00:00:00Z"),
        method: "BANK_TRANSFER",
        status: "PLANNED",
        recorderUserId: adminUser!.id,
        createdById: adminUser!.id,
        updatedById: adminUser!.id
      }
    });
    createdPaymentIds.push(pay.id);
    await expect(softDeleteContract(adminUser!, c.id)).rejects.toMatchObject({
      errorCode: ERROR_CODES.ENTITY_IMMUTABLE
    });
  }));

  it("存在附件 → 拒绝删除", guard(async () => {
    const c = await mkContract("HAS-ATTACHMENT");
    const att = await prisma.attachment.create({
      data: {
        objectKey: `tmp/2026/01/${TAG}-attachment.txt`,
        bucket: "test-bucket",
        originalName: `${TAG}-attachment.txt`,
        mimeType: "text/plain",
        size: 10,
        uploadedById: adminUser!.id,
        contractId: c.id
      }
    });
    createdAttachmentIds.push(att.id);
    await expect(softDeleteContract(adminUser!, c.id)).rejects.toMatchObject({
      errorCode: ERROR_CODES.ENTITY_IMMUTABLE
    });
  }));
});
