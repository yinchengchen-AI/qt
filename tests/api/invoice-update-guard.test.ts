// 发票编辑保护回归
//
// 覆盖:
//   1) updateInvoice 丢弃 contractId/status/invoiceNo 等不可更新字段
//   2) updateInvoice 改金额时 R-08 把其它 DRAFT 发票计入
//   3) createInvoice 传入附件后, getInvoice 返回的 attachments JSON 快照非空

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { createInvoice, updateInvoice, getInvoice } from "@/server/services/invoice";

let dbReachable = false;
const TAG = `TEST-INV-GUARD-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdInvoiceIds: string[] = [];
const createdContractNos: string[] = [];
const createdAttachmentIds: string[] = [];
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
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
  if (!adminRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN" };
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
    if (createdInvoiceIds.length > 0) {
      await prisma.invoiceAuditLog.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.payment.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdContractNos.length > 0) {
      await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
    }
    if (createdAttachmentIds.length > 0) {
      await prisma.attachment.deleteMany({ where: { id: { in: createdAttachmentIds } } });
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
  if (!adminUser || !testCustomerId) return;
  await fn();
};

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return { id: adminUser.id, employeeNo: adminUser.employeeNo, name: adminUser.name, email: adminUser.email, roleCode: "ADMIN", permissions: [] };
};

async function mkContract(totalAmount: string, suffix: string) {
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
      status: "ACTIVE",
      ownerUserId: adminUser.id,
      signerId: adminUser.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
}

async function mkAttachment() {
  if (!adminUser) throw new Error("setup not ready");
  const a = await prisma.attachment.create({
    data: {
      originalName: `${TAG}-file.pdf`,
      objectKey: `${TAG}/file.pdf`,
      bucket: "qt-biz",
      mimeType: "application/pdf",
      size: 1024,
      uploadedById: adminUser.id,
      invoiceId: null,
      contractId: null
    }
  });
  createdAttachmentIds.push(a.id);
  return {
    id: a.id,
    name: a.originalName,
    mimeType: a.mimeType,
    size: a.size,
    uploadedBy: a.uploadedById,
    uploadedAt: a.uploadedAt.toISOString()
  };
}

describe("updateInvoice 字段白名单", () => {
  it("传入 contractId/status/invoiceNo 等字段不会被写入", guard(async () => {
    const c1 = await mkContract("100.00", "GUARD-1");
    const c2 = await mkContract("100.00", "GUARD-2");
    const inv = await createInvoice(buildAdmin(), {
      contractId: c1.id,
      invoiceNo: `${TAG}-GUARD-ORIGIN`,
      invoiceType: "VAT_SPECIAL",
      amount: 50,
      taxRate: 0.06,
      applyDate: new Date().toISOString(),
      titleType: "COMPANY",
      titleName: `${TAG}-抬头`,
      taxNo: "91330000123456789X",
      attachments: []
    });
    if (!inv) throw new Error("createInvoice returned null");
    createdInvoiceIds.push(inv.id);

    const updated = await updateInvoice(buildAdmin(), inv.id, {
      contractId: c2.id,
      invoiceNo: `${TAG}-GUARD-NEWNO`,
      status: "ISSUED",
      amount: 60,
      titleName: "新抬头名称"
    } as unknown as Parameters<typeof updateInvoice>[2]);

    expect(updated.contractId).toBe(c1.id);
    expect(updated.invoiceNo).toBe(`${TAG}-GUARD-ORIGIN`);
    expect(updated.status).toBe("DRAFT");
    expect(updated.amount.toString()).toBe("60");
    expect(updated.titleName).toBe("新抬头名称");
  }));
});

describe("updateInvoice R-08 包含其它 DRAFT", () => {
  it("两个 DRAFT 各占 60, 把其中一个改为 50 会触发超额", guard(async () => {
    const c = await mkContract("100.00", "R08-DRAFT");
    const inv1 = await createInvoice(buildAdmin(), {
      contractId: c.id,
      invoiceNo: `${TAG}-R08A`,
      invoiceType: "VAT_SPECIAL",
      amount: 60,
      taxRate: 0.06,
      applyDate: new Date().toISOString(),
      titleType: "COMPANY",
      titleName: `${TAG}-抬头`,
      taxNo: "91330000123456789X",
      attachments: []
    });
    if (!inv1) throw new Error("createInvoice returned null");
    createdInvoiceIds.push(inv1.id);

    const inv2 = await createInvoice(buildAdmin(), {
      contractId: c.id,
      invoiceNo: `${TAG}-R08B`,
      invoiceType: "VAT_SPECIAL",
      amount: 10,
      taxRate: 0.06,
      applyDate: new Date().toISOString(),
      titleType: "COMPANY",
      titleName: `${TAG}-抬头`,
      taxNo: "91330000123456789X",
      attachments: []
    });
    if (!inv2) throw new Error("createInvoice returned null");
    createdInvoiceIds.push(inv2.id);

    // 当前 DRAFT 合计 70, inv2 改到 50 → 总额 110 > 100, 应被拒
    await expect(
      updateInvoice(buildAdmin(), inv2.id, { amount: 50 })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.INVOICE_OVER_LIMIT });
  }));
});

describe("createInvoice 附件快照", () => {
  it("传入附件后 getInvoice 返回 attachments 数组", guard(async () => {
    const c = await mkContract("100.00", "ATTACH");
    const att = await mkAttachment();
    const inv = await createInvoice(buildAdmin(), {
      contractId: c.id,
      invoiceNo: `${TAG}-ATTACH`,
      invoiceType: "VAT_SPECIAL",
      amount: 50,
      taxRate: 0.06,
      applyDate: new Date().toISOString(),
      titleType: "COMPANY",
      titleName: `${TAG}-抬头`,
      taxNo: "91330000123456789X",
      attachments: [att]
    });
    if (!inv) throw new Error("createInvoice returned null");
    createdInvoiceIds.push(inv.id);

    const fromDb = await getInvoice(buildAdmin(), inv.id);
    const attachments = (fromDb.attachments ?? []) as Array<{ id: string }>;
    expect(Array.isArray(attachments)).toBe(true);
    expect(attachments.length).toBe(1);
    expect(attachments[0]?.id).toBe(att.id);
  }));
});
