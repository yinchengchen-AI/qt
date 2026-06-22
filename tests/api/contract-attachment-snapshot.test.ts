// 合同附件删除后 Contract.attachments JSON 快照同步回归
//
// 覆盖:
//   1) 删除合同普通附件后,Contract.attachments 中该附件 id 被移除
//   2) 删除后 updateContract 不因为快照残留而报错
//   3) 删除交付物附件(isDeliverable=true)不影响合同快照
//
// DB 不可达时整组 skip. 数据带唯一 TAG 前缀,跑完自清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { createContract, updateContract } from "@/server/services/contract";
import { softDeleteAttachment } from "@/server/storage/presign";

let dbReachable = false;
const TAG = `TEST-CONTRACT-ATT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let testCustomerId: string | null = null;
const createdContractIds: string[] = [];
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
    if (createdAttachmentIds.length > 0) {
      await prisma.attachment.deleteMany({ where: { id: { in: createdAttachmentIds } } });
    }
    if (createdContractIds.length > 0) {
      await prisma.contractReviewLog.deleteMany({ where: { contractId: { in: createdContractIds } } });
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

async function mkContractWithAttachments() {
  if (!adminUser || !testCustomerId) throw new Error("setup not ready");
  const suffix1 = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const suffix2 = `${Date.now() + 1}-${Math.random().toString(36).slice(2, 8)}`;
  const [att1, att2] = await Promise.all([
    prisma.attachment.create({
      data: {
        objectKey: `tmp/2026/01/${TAG}-${suffix1}.txt`,
        bucket: "test-bucket",
        originalName: `${TAG}-${suffix1}.txt`,
        mimeType: "text/plain",
        size: 10,
        uploadedById: adminUser.id
      }
    }),
    prisma.attachment.create({
      data: {
        objectKey: `tmp/2026/01/${TAG}-${suffix2}.txt`,
        bucket: "test-bucket",
        originalName: `${TAG}-${suffix2}.txt`,
        mimeType: "text/plain",
        size: 10,
        uploadedById: adminUser.id
      }
    })
  ]);
  createdAttachmentIds.push(att1.id, att2.id);

  const c = await createContract(adminUser, {
    customerId: testCustomerId,
    contractNo: `${TAG}-${createdContractIds.length}`,
    title: `${TAG}-title`,
    serviceType: "OTHER",
    signDate: "2026-01-01T00:00:00.000Z",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-12-31T00:00:00.000Z",
    totalAmount: 10000,
    taxRate: 0.06,
    paymentMethod: "LUMP_SUM",
    attachments: [
      {
        id: att1.id,
        name: att1.originalName,
        mimeType: att1.mimeType,
        size: att1.size,
        uploadedBy: adminUser.id,
        uploadedAt: new Date().toISOString()
      },
      {
        id: att2.id,
        name: att2.originalName,
        mimeType: att2.mimeType,
        size: att2.size,
        uploadedBy: adminUser.id,
        uploadedAt: new Date().toISOString()
      }
    ]
  });
  if (!c) throw new Error("createContract returned null");
  createdContractIds.push(c.id);
  return { contract: c, att1, att2 };
}

describe("合同附件删除后快照同步", () => {
  it("删除普通附件后 Contract.attachments 不再包含该 id", guard(async () => {
    const { contract, att1 } = await mkContractWithAttachments();
    const before = await prisma.contract.findUnique({ where: { id: contract.id }, select: { attachments: true } });
    expect((before?.attachments as Array<{ id: string }>).map((a) => a.id)).toContain(att1.id);

    await softDeleteAttachment(att1.id, adminUser!.id);

    const after = await prisma.contract.findUnique({ where: { id: contract.id }, select: { attachments: true } });
    expect((after?.attachments as Array<{ id: string }>).map((a) => a.id)).not.toContain(att1.id);
  }));

  it("删除后 updateContract 不会因快照残留而报错", guard(async () => {
    const { contract, att1 } = await mkContractWithAttachments();
    await softDeleteAttachment(att1.id, adminUser!.id);
    const updated = await updateContract(adminUser!, contract.id, { title: `${TAG}-after-delete` });
    if (!updated) throw new Error("updateContract returned null");
    expect(updated.title).toBe(`${TAG}-after-delete`);
  }));

  it("删除交付物附件不影响 Contract.attachments", guard(async () => {
    const { contract, att1 } = await mkContractWithAttachments();
    // 把 att1 改成交付物附件,并绑定到合同
    await prisma.attachment.update({
      where: { id: att1.id },
      data: { contractId: contract.id, isDeliverable: true }
    });
    const before = await prisma.contract.findUnique({ where: { id: contract.id }, select: { attachments: true } });
    expect((before?.attachments as Array<{ id: string }>).map((a) => a.id)).toContain(att1.id);

    await softDeleteAttachment(att1.id, adminUser!.id);

    const after = await prisma.contract.findUnique({ where: { id: contract.id }, select: { attachments: true } });
    // 交付物附件不在快照维护范围,原快照保留
    expect((after?.attachments as Array<{ id: string }>).map((a) => a.id)).toContain(att1.id);
  }));
});
