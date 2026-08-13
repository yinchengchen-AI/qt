// 合同域"读放开 + 写守门"回归 (plan: .omo/plans/role-browse-permissions.md todo 4)
//
// 新口径:
//   - SALES/EXPERT 可读全公司合同: list / get / 360 overview / operation-logs /
//     publish-eligibility 全部 200 (不再按 owner 过滤, 404 仅用于真不存在)。
//   - 写仍按 owner: SALES PATCH 他人合同 → 403 FORBIDDEN (无权操作他人合同);
//     SALES PATCH 自己 DRAFT → 200; 自己 ACTIVE → 403 ENTITY_IMMUTABLE (状态门控保留);
//     非 ADMIN 变更 ownerUserId / signerId → 422 (既有护栏保留)。
//   - PATCH 不存在的合同 → 404 (lookup 无条件后先 404, 再 owner 断言)。
//
// DB 不可达时整组 skip (与 tests/api/contract-operation-logs.test.ts 同模式)。
// 路由用例 (publish-eligibility) 通过 vi.mock("@/lib/session") 注入 actor。

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import { ERROR_CODES } from "@/types/errors";

import {
  listContracts,
  getContract,
  updateContract,
  getContractOverview,
  getContractOperationLogs,
} from "@/server/services/contract";
import { GET as getPublishEligibility } from "@/app/api/contracts/[id]/publish-eligibility/route";

// 路由测试用: mock requireSession 返回当前 actor (per-case 注入)
const sessionHolder = vi.hoisted(() => ({ actor: null as SessionUser | null }));
vi.mock("@/lib/session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...mod,
    requireSession: async (): Promise<SessionUser> => {
      if (!sessionHolder.actor) throw new Error("no actor injected");
      return sessionHolder.actor;
    },
  };
});

function mkUser(roleCode: SessionUser["roleCode"], id: string): SessionUser {
  return { id, employeeNo: id, name: id, email: `${id}@t.local`, roleCode, permissions: [] };
}

let dbReachable = false;
const TAG = `TEST-CTRBROWSE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminId: string | null = null;
let salesOwnerId: string | null = null;
let salesOtherId: string | null = null;
let customerId: string | null = null;

// 合同 fixture id
let otherActiveId: string | null = null; // salesOther 的 ACTIVE (读放开断言用)
let otherDraftId: string | null = null; // salesOther 的 DRAFT (写守门 403 + publish-eligibility 用)
let ownDraftId: string | null = null; // salesOwner 的 DRAFT (自己 PATCH → 200)
let ownActiveId: string | null = null; // salesOwner 的 ACTIVE (状态门控 403)

const cleanupInvoiceIds: string[] = [];
const cleanupPaymentIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const [admin, salesRows] = await Promise.all([
    prisma.user.findFirst({ where: { role: { code: "ADMIN" }, deletedAt: null, isSystem: false }, select: { id: true } }),
    prisma.user.findMany({ where: { role: { code: "SALES" }, deletedAt: null }, take: 2, select: { id: true } }),
  ]);
  if (!admin || salesRows.length < 2) {
    dbReachable = false;
    return;
  }
  adminId = admin.id;
  salesOwnerId = salesRows[0]!.id;
  salesOtherId = salesRows[1]!.id;

  const customer = await prisma.customer.create({
    data: {
      code: `${TAG}-C1`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000000",
      ownerUserId: salesOtherId,
      createdById: adminId,
      updatedById: adminId,
    },
    select: { id: true },
  });
  customerId = customer.id;

  const mk = async (suffix: string, ownerId: string, status: "DRAFT" | "ACTIVE") => {
    const c = await prisma.contract.create({
      data: {
        contractNo: `${TAG}-${suffix}`,
        customerId: customer.id,
        customerName: `${TAG}-客户`,
        title: `${TAG}-title-${suffix}`,
        serviceType: "OTHER",
        signDate: new Date("2026-01-01T00:00:00Z"),
        startDate: new Date("2026-01-01T00:00:00Z"),
        endDate: new Date("2026-12-31T00:00:00Z"),
        totalAmount: 10000,
        taxRate: 0.06,
        taxAmount: 600,
        amountExcludingTax: 9400,
        paymentMethod: "LUMP_SUM",
        status,
        ownerUserId: ownerId,
        signerId: ownerId,
        attachments: [],
        createdById: adminId!,
        updatedById: adminId!,
      },
      select: { id: true },
    });
    return c.id;
  };

  otherActiveId = await mk("OTHER-ACTIVE", salesOtherId, "ACTIVE");
  otherDraftId = await mk("OTHER-DRAFT", salesOtherId, "DRAFT");
  ownDraftId = await mk("OWN-DRAFT", salesOwnerId, "DRAFT");
  ownActiveId = await mk("OWN-ACTIVE", salesOwnerId, "ACTIVE");

  // 360 视图读放开断言: 在他人 ACTIVE 合同上挂一条发票 + 一条回款
  const inv = await prisma.invoice.create({
    data: {
      invoiceNo: `${TAG}-INV-1`,
      contractId: otherActiveId,
      customerId: customer.id,
      customerName: `${TAG}-客户`,
      invoiceType: "VAT_GENERAL",
      amount: 1000,
      taxRate: 0.06,
      taxAmount: 60,
      amountExcludingTax: 940,
      applyDate: new Date("2026-01-01T00:00:00Z"),
      titleType: "COMPANY",
      titleName: `${TAG}-抬头`,
      status: "ISSUED",
      applicantUserId: adminId,
      createdById: adminId,
      updatedById: adminId,
    },
    select: { id: true },
  });
  cleanupInvoiceIds.push(inv.id);
  const pay = await prisma.payment.create({
    data: {
      paymentNo: `${TAG}-PAY-1`,
      customerId: customer.id,
      contractId: otherActiveId,
      amount: 1000,
      receivedAt: new Date("2026-01-01T00:00:00Z"),
      method: "BANK_TRANSFER",
      status: "CONFIRMED",
      recorderUserId: adminId,
      createdById: adminId,
      updatedById: adminId,
    },
    select: { id: true },
  });
  cleanupPaymentIds.push(pay.id);
});

afterAll(async () => {
  if (!dbReachable || !customerId) return;
  try {
    if (cleanupInvoiceIds.length > 0) {
      await prisma.invoice.deleteMany({ where: { id: { in: cleanupInvoiceIds } } });
    }
    if (cleanupPaymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: cleanupPaymentIds } } });
    }
    await prisma.operationLog.deleteMany({ where: { entityId: { contains: TAG } } });
    await prisma.contract.deleteMany({ where: { customerId } });
    await prisma.customer.delete({ where: { id: customerId } });
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminId || !salesOwnerId || !salesOtherId) return;
  await fn();
};

describe("contract 域读放开 (SALES 读他人合同 → 200)", () => {
  it("listContracts: SALES 列表可见他人 owner 的合同", guard(async () => {
    const sales = mkUser("SALES", salesOwnerId!);
    const { list } = await listContracts(sales, { page: 1, pageSize: 50, keyword: TAG });
    const nos = list.map((c) => c.contractNo);
    expect(nos).toContain(`${TAG}-OTHER-ACTIVE`);
    expect(nos).toContain(`${TAG}-OTHER-DRAFT`);
    expect(nos).toContain(`${TAG}-OWN-DRAFT`);
  }));

  it("getContract: SALES 读他人合同详情 → 200", guard(async () => {
    const sales = mkUser("SALES", salesOwnerId!);
    const c = await getContract(sales, otherActiveId!);
    expect(c.id).toBe(otherActiveId);
    expect(c.contractNo).toBe(`${TAG}-OTHER-ACTIVE`);
  }));

  it("getContractOverview: SALES 读他人合同 360 视图 → 200 且发票/回款可见", guard(async () => {
    const sales = mkUser("SALES", salesOwnerId!);
    const ov = await getContractOverview(sales, otherActiveId!);
    expect(ov.invoices.length).toBe(1);
    expect(ov.payments.length).toBe(1);
    expect(ov.totals.invoicedAmount).toBe(1000);
    expect(ov.totals.paidAmount).toBe(1000);
  }));

  it("getContractOperationLogs: SALES 读他人合同操作日志 → 200", guard(async () => {
    const sales = mkUser("SALES", salesOwnerId!);
    const page = await getContractOperationLogs(sales, otherActiveId!, { page: 1, pageSize: 50 });
    expect(page.page).toBe(1);
    expect(Array.isArray(page.list)).toBe(true);
  }));

  it("publish-eligibility 路由: SALES 查他人 DRAFT 合同 → 200", guard(async () => {
    const sales = mkUser("SALES", salesOwnerId!);
    sessionHolder.actor = sales;
    try {
      const res = await getPublishEligibility(
        new Request(`http://localhost/api/contracts/${otherDraftId}/publish-eligibility`),
        { params: Promise.resolve({ id: otherDraftId! }) }
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { code: number; data: { status: string; eligible: boolean } };
      expect(body.data.status).toBe("DRAFT");
    } finally {
      sessionHolder.actor = null;
    }
  }));
});

describe("contract 域写守门 (SALES 写他人合同 → 403, 自己保留原门控)", () => {
  it("SALES PATCH 他人 DRAFT 合同 → 403 FORBIDDEN (无权操作他人合同)", guard(async () => {
    const sales = mkUser("SALES", salesOwnerId!);
    await expect(
      updateContract(sales, otherDraftId!, { title: `${TAG}-越权改写` })
    ).rejects.toMatchObject({
      status: 403,
      errorCode: ERROR_CODES.FORBIDDEN,
      message: expect.stringContaining("无权操作他人合同"),
    });
  }));

  it("SALES PATCH 自己 DRAFT 合同 → 200", guard(async () => {
    const sales = mkUser("SALES", salesOwnerId!);
    const updated = await updateContract(sales, ownDraftId!, { title: `${TAG}-自己改写` });
    expect(updated.id).toBe(ownDraftId);
    expect(updated.title).toBe(`${TAG}-自己改写`);
  }));

  it("SALES PATCH 自己 ACTIVE 合同 → 403 ENTITY_IMMUTABLE (状态门控保留)", guard(async () => {
    const sales = mkUser("SALES", salesOwnerId!);
    await expect(
      updateContract(sales, ownActiveId!, { title: `${TAG}-状态门控` })
    ).rejects.toMatchObject({
      status: 403,
      errorCode: ERROR_CODES.ENTITY_IMMUTABLE,
    });
  }));

  it("非 ADMIN 变更 ownerUserId → 422 (既有护栏保留)", guard(async () => {
    const sales = mkUser("SALES", salesOwnerId!);
    await expect(
      updateContract(sales, ownDraftId!, { ownerUserId: salesOtherId! })
    ).rejects.toMatchObject({
      status: 422,
      errorCode: ERROR_CODES.VALIDATION_FAILED,
      message: expect.stringContaining("仅管理员可变更合同负责人"),
    });
  }));

  it("非 ADMIN 变更 signerId → 422 (既有护栏保留)", guard(async () => {
    const sales = mkUser("SALES", salesOwnerId!);
    await expect(
      updateContract(sales, ownDraftId!, { signerId: salesOtherId! })
    ).rejects.toMatchObject({
      status: 422,
      errorCode: ERROR_CODES.VALIDATION_FAILED,
      message: expect.stringContaining("仅管理员可变更合同签订人"),
    });
  }));

  it("SALES PATCH 不存在的合同 → 404 NOT_FOUND (malformed input)", guard(async () => {
    const sales = mkUser("SALES", salesOwnerId!);
    await expect(
      updateContract(sales, "non-existent-contract-id", { title: "x" })
    ).rejects.toMatchObject({
      status: 404,
      errorCode: ERROR_CODES.NOT_FOUND,
    });
  }));
});
