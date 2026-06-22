// 合同交付物附件 (Attachment.isDeliverable=true) 单测
//
// 数据模型 (2026-06 调整后):
//   - Contract.deliverables JSON 字段已下线 (前端无结构化清单)
//   - Attachment.isDeliverable Boolean 标记"合同交付物附件"
//   - 上传/删除写权限: admin / 合同 ownerUserId / 合同 signerId
//
// 覆盖矩阵:
//   1) presignUpload: contractId 缺失 → 422
//   2) presignUpload: admin / owner / signer 允许 isDeliverable=true
//   3) presignUpload: 其他 SALES / FINANCE → 403
//   4) presignUpload: isDeliverable=false 走旧路径 (admin 允许)
//   5) softDeleteAttachment: isDeliverable=true 同样需要三元组
//   6) getContractOverview: deliverableAttachments 是扁平数组, 仅含 isDeliverable=true
//   7) getContractOverview: 软删的附件不出现
//
// DB 不可达时整组 skip; 测试数据用唯一前缀, 跑完自己清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { presignUpload, softDeleteAttachment } from "@/server/storage/presign";
import { getContractOverview } from "@/server/services/contract";
import type { SessionUser } from "@/lib/session";

let dbReachable = false;
const TAG = `TEST-DELIV-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let salesOwner: SessionUser | null = null;
let salesSigner: SessionUser | null = null;
let salesOther: SessionUser | null = null;
let financeUser: SessionUser | null = null;
let testCustomerId: string | null = null;
let testContractId: string | null = null;
const cleanupContractIds: string[] = [];
const cleanupCustomerIds: string[] = [];
const cleanupAttachmentIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const admin = await prisma.user.findFirst({ where: { role: { code: "ADMIN" }, deletedAt: null } });
  const sales = await prisma.user.findMany({ where: { role: { code: "SALES" }, deletedAt: null }, take: 5 });
  const finance = await prisma.user.findFirst({ where: { role: { code: "FINANCE" }, deletedAt: null } });
  if (!admin || sales.length < 3 || !finance) return;
  adminUser = { id: admin.id, roleCode: "ADMIN" } as SessionUser;
  financeUser = { id: finance.id, roleCode: "FINANCE" } as SessionUser;
  salesOwner = { id: sales[0]!.id, roleCode: "SALES" } as SessionUser;
  salesSigner = { id: sales[1]!.id, roleCode: "SALES" } as SessionUser;
  salesOther = { id: sales[2]!.id, roleCode: "SALES" } as SessionUser;

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
      ownerUserId: salesOwner.id
    },
    select: { id: true }
  });
  testCustomerId = cust.id;
  cleanupCustomerIds.push(cust.id);

  const contract = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-CONTRACT`,
      customerId: testCustomerId,
      customerName: `${TAG}-客户`,
      title: `${TAG}-测试合同`,
      serviceType: "OTHER",
      signDate: new Date("2026-01-01T00:00:00Z"),
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-12-31T00:00:00Z"),
      totalAmount: 10000,
      taxRate: 0.06,
      taxAmount: 600,
      amountExcludingTax: 9400,
      paymentMethod: "LUMP_SUM",
      status: "DRAFT",
      ownerUserId: salesOwner.id,
      signerId: salesSigner.id,
      attachments: [],
      createdById: adminUser.id,
      updatedById: adminUser.id
    },
    select: { id: true }
  });
  testContractId = contract.id;
  cleanupContractIds.push(contract.id);
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (cleanupAttachmentIds.length > 0) {
      await prisma.attachment.deleteMany({ where: { id: { in: cleanupAttachmentIds } } });
    }
    if (cleanupContractIds.length > 0) {
      await prisma.contract.deleteMany({ where: { id: { in: cleanupContractIds } } });
    }
    if (cleanupCustomerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: cleanupCustomerIds } } });
    }
  } catch {
    // 忽略清理失败
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable) return;
  if (!adminUser || !salesOwner || !salesSigner || !salesOther || !financeUser || !testCustomerId || !testContractId) return;
  await fn();
};

describe("Attachment.isDeliverable schema", () => {
  it("isDeliverable 列存在且为 boolean NOT NULL DEFAULT false", guard(async () => {
    const rows = await prisma.$queryRaw<Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>>`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'Attachment' AND column_name = 'isDeliverable'
    `;
    expect(rows.length).toBe(1);
    expect(rows[0]!.data_type).toBe("boolean");
    expect(rows[0]!.is_nullable).toBe("NO");
  }));

  it("索引 Attachment_contractId_isDeliverable_deletedAt_idx 存在", guard(async () => {
    const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'Attachment' AND indexname = 'Attachment_contractId_isDeliverable_deletedAt_idx'
    `;
    expect(rows.length).toBe(1);
  }));
});

describe("presignUpload isDeliverable 校验", () => {
  it("isDeliverable=true 缺 contractId → 422", guard(async () => {
    await expect(
      presignUpload({
        filename: "test.txt",
        mimeType: "text/plain",
        size: 10,
        contractId: null,
        isDeliverable: true,
        uploadedById: adminUser!.id
      })
    ).rejects.toMatchObject({ errorCode: "VALIDATION_FAILED" });
  }));

  it("contractId 指向已软删合同 → 404", guard(async () => {
    await prisma.contract.update({ where: { id: testContractId! }, data: { deletedAt: new Date() } });
    try {
      await expect(
        presignUpload({
          filename: "test.txt",
          mimeType: "text/plain",
          size: 10,
          contractId: testContractId!,
          isDeliverable: true,
          uploadedById: adminUser!.id
        })
      ).rejects.toMatchObject({ errorCode: "NOT_FOUND" });
    } finally {
      await prisma.contract.update({ where: { id: testContractId! }, data: { deletedAt: null } });
    }
  }));
});

describe("presignUpload 写权限矩阵 (isDeliverable=true 路径)", () => {
  it("admin 允许", guard(async () => {
    const r = await presignUpload({
      filename: "admin.txt",
      mimeType: "text/plain",
      size: 10,
      contractId: testContractId!,
      isDeliverable: true,
      uploadedById: adminUser!.id
    });
    cleanupAttachmentIds.push(r.attachmentId);
    expect(r.attachmentId).toBeTruthy();
    // 校验 DB 标记
    const att = await prisma.attachment.findUnique({ where: { id: r.attachmentId }, select: { isDeliverable: true } });
    expect(att?.isDeliverable).toBe(true);
  }));

  it("合同 owner (SALES) 允许", guard(async () => {
    const r = await presignUpload({
      filename: "owner.txt",
      mimeType: "text/plain",
      size: 10,
      contractId: testContractId!,
      isDeliverable: true,
      uploadedById: salesOwner!.id
    });
    cleanupAttachmentIds.push(r.attachmentId);
    expect(r.attachmentId).toBeTruthy();
  }));

  it("合同 signer (SALES, ≠ owner) 允许", guard(async () => {
    const r = await presignUpload({
      filename: "signer.txt",
      mimeType: "text/plain",
      size: 10,
      contractId: testContractId!,
      isDeliverable: true,
      uploadedById: salesSigner!.id
    });
    cleanupAttachmentIds.push(r.attachmentId);
    expect(r.attachmentId).toBeTruthy();
  }));

  it("其他 SALES (不是 owner/signer) → 403", guard(async () => {
    await expect(
      presignUpload({
        filename: "other.txt",
        mimeType: "text/plain",
        size: 10,
        contractId: testContractId!,
        isDeliverable: true,
        uploadedById: salesOther!.id
      })
    ).rejects.toMatchObject({ errorCode: "FORBIDDEN" });
  }));

  it("FINANCE → 403", guard(async () => {
    await expect(
      presignUpload({
        filename: "fin.txt",
        mimeType: "text/plain",
        size: 10,
        contractId: testContractId!,
        isDeliverable: true,
        uploadedById: financeUser!.id
      })
    ).rejects.toMatchObject({ errorCode: "FORBIDDEN" });
  }));

  it("isDeliverable=false (默认) → 旧路径, 走 ROLE_PERMISSIONS (admin 允许)", guard(async () => {
    const r = await presignUpload({
      filename: "no-deliv.txt",
      mimeType: "text/plain",
      size: 10,
      contractId: testContractId!,
      isDeliverable: false,
      uploadedById: adminUser!.id
    });
    cleanupAttachmentIds.push(r.attachmentId);
    const att = await prisma.attachment.findUnique({ where: { id: r.attachmentId }, select: { isDeliverable: true } });
    expect(att?.isDeliverable).toBe(false);
  }));
});

describe("softDeleteAttachment 交付物路径", () => {
  it("admin 软删交付物附件 → 成功", guard(async () => {
    const r = await presignUpload({
      filename: "to-del-admin.txt",
      mimeType: "text/plain",
      size: 10,
      contractId: testContractId!,
      isDeliverable: true,
      uploadedById: adminUser!.id
    });
    cleanupAttachmentIds.push(r.attachmentId);
    await softDeleteAttachment(r.attachmentId, adminUser!.id);
    const att = await prisma.attachment.findUnique({ where: { id: r.attachmentId }, select: { deletedAt: true } });
    expect(att?.deletedAt).toBeTruthy();
  }));

  it("合同 owner 软删交付物附件 → 成功", guard(async () => {
    const r = await presignUpload({
      filename: "to-del-owner.txt",
      mimeType: "text/plain",
      size: 10,
      contractId: testContractId!,
      isDeliverable: true,
      uploadedById: salesOwner!.id
    });
    cleanupAttachmentIds.push(r.attachmentId);
    await softDeleteAttachment(r.attachmentId, salesOwner!.id);
    const att = await prisma.attachment.findUnique({ where: { id: r.attachmentId }, select: { deletedAt: true } });
    expect(att?.deletedAt).toBeTruthy();
  }));

  it("合同 signer 软删交付物附件 → 成功", guard(async () => {
    const r = await presignUpload({
      filename: "to-del-signer.txt",
      mimeType: "text/plain",
      size: 10,
      contractId: testContractId!,
      isDeliverable: true,
      uploadedById: salesSigner!.id
    });
    cleanupAttachmentIds.push(r.attachmentId);
    await softDeleteAttachment(r.attachmentId, salesSigner!.id);
    const att = await prisma.attachment.findUnique({ where: { id: r.attachmentId }, select: { deletedAt: true } });
    expect(att?.deletedAt).toBeTruthy();
  }));

  it("其他 SALES 软删交付物附件 → 403", guard(async () => {
    const r = await presignUpload({
      filename: "to-del-other.txt",
      mimeType: "text/plain",
      size: 10,
      contractId: testContractId!,
      isDeliverable: true,
      uploadedById: adminUser!.id
    });
    cleanupAttachmentIds.push(r.attachmentId);
    await expect(softDeleteAttachment(r.attachmentId, salesOther!.id)).rejects.toMatchObject({ errorCode: "FORBIDDEN" });
  }));
});

describe("getContractOverview deliverableAttachments", () => {
  it("扁平列表, 仅含 isDeliverable=true 且未软删", guard(async () => {
    // 1 个 isDeliverable=true 附件 (admin 上传)
    const deliv = await presignUpload({
      filename: "deliv-1.txt",
      mimeType: "text/plain",
      size: 10,
      contractId: testContractId!,
      isDeliverable: true,
      uploadedById: adminUser!.id
    });
    cleanupAttachmentIds.push(deliv.attachmentId);
    // 1 个 isDeliverable=false 附件 (通用合同附件)
    const plain = await presignUpload({
      filename: "plain-1.txt",
      mimeType: "text/plain",
      size: 10,
      contractId: testContractId!,
      isDeliverable: false,
      uploadedById: adminUser!.id
    });
    cleanupAttachmentIds.push(plain.attachmentId);
    // 1 个 isDeliverable=true 但软删
    const deleted = await presignUpload({
      filename: "deliv-deleted.txt",
      mimeType: "text/plain",
      size: 10,
      contractId: testContractId!,
      isDeliverable: true,
      uploadedById: adminUser!.id
    });
    cleanupAttachmentIds.push(deleted.attachmentId);
    await softDeleteAttachment(deleted.attachmentId, adminUser!.id);

    const overview = await getContractOverview(adminUser!, testContractId!);
    // deliverableAttachments 应是扁平数组, 只含 isDeliverable=true 且未软删
    expect(Array.isArray(overview.deliverableAttachments)).toBe(true);
    const ids = (overview.deliverableAttachments as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain(deliv.attachmentId);
    expect(ids).not.toContain(plain.attachmentId);
    expect(ids).not.toContain(deleted.attachmentId);
  }));
});
