// POST /api/contracts 路由/服务层校验回归
//
// 覆盖:
//   1) 客户状态 LEAD → 创建合同失败 (CONTRACT_CUSTOMER_STATUS)
//   2) 止期 <= 起期 → 400 VALIDATION_FAILED
//   3) 签订人 / 负责人为 DISABLED → 400 VALIDATION_FAILED
//   4) 合同编号重复 → 422 VALIDATION_FAILED
//   5) 有附件时 DRAFT 自动升 ACTIVE (auto-publish)
//
// DB 不可达时整组 skip. 数据带唯一 TAG 前缀,跑完自清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { createContract } from "@/server/services/contract";
import type { ContractCreateInput } from "@/lib/validators/contract";

let dbReachable = false;
const TAG = `TEST-CONTRACT-NEW-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let disabledUser: { id: string } | null = null;
let negotiatingCustomerId: string | null = null;
let leadCustomerId: string | null = null;
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

  disabledUser = await prisma.user.create({
    data: {
      employeeNo: `${TAG}-DISABLED`,
      name: `${TAG}-禁用员工`,
      email: `${TAG}-disabled@example.com`,
      passwordHash: "not-valid",
      role: { connect: { code: "SALES" } },
      status: "DISABLED"
    },
    select: { id: true }
  });

  const [negotiating, lead] = await Promise.all([
    prisma.customer.create({
      data: {
        code: `${TAG}-CUST-OK`,
        name: `${TAG}-洽谈中客户`,
        customerType: "ENTERPRISE",
        province: "浙江省",
        city: "杭州市",
        contactPhone: "13800000000",
        status: "NEGOTIATING",
        createdById: adminUser.id,
        updatedById: adminUser.id,
        ownerUserId: adminUser.id
      }
    }),
    prisma.customer.create({
      data: {
        code: `${TAG}-CUST-LEAD`,
        name: `${TAG}-线索客户`,
        customerType: "ENTERPRISE",
        province: "浙江省",
        city: "杭州市",
        contactPhone: "13800000001",
        status: "LEAD",
        createdById: adminUser.id,
        updatedById: adminUser.id,
        ownerUserId: adminUser.id
      }
    })
  ]);
  negotiatingCustomerId = negotiating.id;
  leadCustomerId = lead.id;
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
    await prisma.customer.deleteMany({
      where: { id: { in: [negotiatingCustomerId, leadCustomerId].filter((v): v is string => Boolean(v)) } }
    });
    if (disabledUser) {
      await prisma.user.deleteMany({ where: { id: disabledUser.id } });
    }
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !negotiatingCustomerId) return;
  await fn();
};

function baseInput(contractNo: string): ContractCreateInput {
  return {
    customerId: negotiatingCustomerId!,
    contractNo,
    title: `${TAG}-title`,
    serviceType: "OTHER",
    signDate: "2026-01-01T00:00:00.000Z",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-12-31T00:00:00.000Z",
    totalAmount: 10000,
    taxRate: 0.06,
    paymentMethod: "LUMP_SUM",
    attachments: []
  };
}

describe("createContract 服务层校验", () => {
  it("客户状态 LEAD → 创建合同失败", guard(async () => {
    await expect(
      createContract(adminUser!, { ...baseInput(`${TAG}-LEAD`), customerId: leadCustomerId! })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.CONTRACT_CUSTOMER_STATUS });
  }));

  it("止期 <= 起期 → 400 VALIDATION_FAILED", guard(async () => {
    await expect(
      createContract(adminUser!, {
        ...baseInput(`${TAG}-DATE-ERR`),
        startDate: "2026-12-31T00:00:00.000Z",
        endDate: "2026-01-01T00:00:00.000Z"
      })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));

  it("签订人为 DISABLED 员工 → 400 VALIDATION_FAILED", guard(async () => {
    await expect(
      createContract(adminUser!, {
        ...baseInput(`${TAG}-SIGNER-ERR`),
        signerId: disabledUser!.id
      })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));

  it("负责人为 DISABLED 员工 → 400 VALIDATION_FAILED", guard(async () => {
    await expect(
      createContract(adminUser!, {
        ...baseInput(`${TAG}-OWNER-ERR`),
        ownerUserId: disabledUser!.id
      })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));

  it("合同编号重复 → 422 VALIDATION_FAILED", guard(async () => {
    const no = `${TAG}-DUPLICATE`;
    const first = await createContract(adminUser!, { ...baseInput(no) });
    if (!first) throw new Error("createContract returned null");
    createdContractIds.push(first.id);
    await expect(
      createContract(adminUser!, { ...baseInput(no) })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));

  it("有附件时 DRAFT 自动升 ACTIVE", guard(async () => {
    // 造一个未绑定的附件记录,模拟 presign 后落在 tmp 的状态
    const att = await prisma.attachment.create({
      data: {
        objectKey: `tmp/2026/01/${TAG}-auto-publish.txt`,
        bucket: "test-bucket",
        originalName: `${TAG}-auto-publish.txt`,
        mimeType: "text/plain",
        size: 10,
        uploadedById: adminUser!.id
      }
    });
    createdAttachmentIds.push(att.id);

    const c = await createContract(adminUser!, {
      ...baseInput(`${TAG}-AUTO-PUB`),
      attachments: [
        {
          id: att.id,
          name: att.originalName,
          mimeType: att.mimeType,
          size: att.size,
          uploadedBy: adminUser!.id,
          uploadedAt: new Date().toISOString()
        }
      ]
    });
    if (!c) throw new Error("createContract returned null");
    createdContractIds.push(c.id);
    expect(c.status).toBe("ACTIVE");

    // 附件应被绑定到该合同
    const reloaded = await prisma.attachment.findUnique({ where: { id: att.id } });
    expect(reloaded?.contractId).toBe(c!.id);
  }));
});
