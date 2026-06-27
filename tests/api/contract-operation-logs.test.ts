// 合同维度操作日志
//
// 覆盖矩阵:
//   1) ADMIN 可看到本合同 + 关联发票 + 关联回款 的全部日志
//   2) SALES 越权访问别人 owner 的合同 → 404
//   3) SALES 看自己 owner 的合同 → OK 且包含关联发票/回款的日志
//   4) 无关合同的日志不会被混入（其他合同的 OperationLog 不应出现）
//   5) 分页参数 total / page / pageSize 正确
//   6) actor 字段：系统用户给 isSystem=true；普通用户给 isSystem=false
//
// DB 不可达时整组 skip；数据用唯一 TAG 前缀，跑完自清理。

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { getContractOperationLogs } from "@/server/services/contract";
import { SYSTEM_USER_ID } from "@/lib/system";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";

let dbReachable = false;
const TAG = `TEST-OPLOG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let salesOwner: SessionUser | null = null;
let salesOther: SessionUser | null = null;
let testCustomerId: string | null = null;
let testCustomer2Id: string | null = null;
const cleanupContractIds: string[] = [];
const cleanupInvoiceIds: string[] = [];
const cleanupPaymentIds: string[] = [];
const cleanupCustomerIds: string[] = [];
const cleanupOpLogIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const admin = await prisma.user.findFirst({
    where: { role: { code: "ADMIN" }, deletedAt: null },
  });
  const sales = await prisma.user.findMany({
    where: { role: { code: "SALES" }, deletedAt: null },
    take: 2,
  });
  if (!admin || sales.length < 2) return;
  adminUser = { id: admin.id, roleCode: "ADMIN" } as SessionUser;
  salesOwner = { id: sales[0]!.id, roleCode: "SALES" } as SessionUser;
  salesOther = { id: sales[1]!.id, roleCode: "SALES" } as SessionUser;

  const c1 = await prisma.customer.create({
    data: {
      code: `${TAG}-C1`,
      name: `${TAG}-客户1`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000000",
      status: "NEGOTIATING",
      createdById: adminUser.id,
      updatedById: adminUser.id,
      ownerUserId: salesOwner.id,
    },
    select: { id: true },
  });
  testCustomerId = c1.id;
  cleanupCustomerIds.push(c1.id);

  const c2 = await prisma.customer.create({
    data: {
      code: `${TAG}-C2`,
      name: `${TAG}-客户2`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000001",
      status: "NEGOTIATING",
      createdById: adminUser.id,
      updatedById: adminUser.id,
      ownerUserId: salesOther.id,
    },
    select: { id: true },
  });
  testCustomer2Id = c2.id;
  cleanupCustomerIds.push(c2.id);
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (cleanupOpLogIds.length > 0) {
      await prisma.operationLog.deleteMany({ where: { id: { in: cleanupOpLogIds } } });
    }
    if (cleanupInvoiceIds.length > 0) {
      await prisma.invoice.deleteMany({ where: { id: { in: cleanupInvoiceIds } } });
    }
    if (cleanupPaymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: cleanupPaymentIds } } });
    }
    if (cleanupContractIds.length > 0) {
      await prisma.contract.deleteMany({ where: { id: { in: cleanupContractIds } } });
    }
    if (cleanupCustomerIds.length > 0) {
      await prisma.customer.deleteMany({ where: { id: { in: cleanupCustomerIds } } });
    }
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable) return;
  if (!adminUser || !salesOwner || !salesOther || !testCustomerId || !testCustomer2Id) return;
  await fn();
};

async function mkContract(suffix: string, ownerId: string, customerId: string) {
  if (!adminUser) throw new Error("admin not ready");
  const c = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-${suffix}`,
      customerId,
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
      status: "ACTIVE",
      ownerUserId: ownerId,
      signerId: ownerId,
      attachments: [],
      createdById: adminUser.id,
      updatedById: adminUser.id,
    },
    select: { id: true },
  });
  cleanupContractIds.push(c.id);
  return c.id;
}

async function mkInvoice(contractId: string, customerId: string) {
  if (!adminUser) throw new Error("admin not ready");
  const inv = await prisma.invoice.create({
    data: {
      invoiceNo: `${TAG}-INV-${Math.random().toString(36).slice(2, 6)}`,
      contractId,
      customerId,
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
      applicantUserId: adminUser.id,
      createdById: adminUser.id,
      updatedById: adminUser.id,
    },
    select: { id: true },
  });
  cleanupInvoiceIds.push(inv.id);
  return inv.id;
}

async function mkPayment(contractId: string, customerId: string) {
  if (!adminUser) throw new Error("admin not ready");
  const p = await prisma.payment.create({
    data: {
      paymentNo: `${TAG}-PAY-${Math.random().toString(36).slice(2, 6)}`,
      customerId,
      contractId,
      amount: 1000,
      receivedAt: new Date("2026-01-01T00:00:00Z"),
      method: "BANK_TRANSFER",
      status: "CONFIRMED",
      recorderUserId: adminUser.id,
      createdById: adminUser.id,
      updatedById: adminUser.id,
    },
    select: { id: true },
  });
  cleanupPaymentIds.push(p.id);
  return p.id;
}

async function mkOpLog(input: {
  actorId: string;
  action: string;
  entity: string;
  entityId: string;
  status?: "SUCCESS" | "FAILURE";
}) {
  const log = await prisma.operationLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      status: input.status ?? "SUCCESS",
    },
    select: { id: true },
  });
  cleanupOpLogIds.push(log.id);
  return log.id;
}

describe("getContractOperationLogs: 权限与隔离", () => {
  it("ADMIN 可看到本合同+发票+回款 的所有日志", guard(async () => {
    const contractId = await mkContract("ADM-1", adminUser!.id, testCustomerId!);
    const invId = await mkInvoice(contractId, testCustomerId!);
    const payId = await mkPayment(contractId, testCustomerId!);

    await mkOpLog({ actorId: adminUser!.id, action: "CONTRACT_UPDATE", entity: "Contract", entityId: contractId });
    await mkOpLog({ actorId: adminUser!.id, action: "INVOICE_ISSUE", entity: "Invoice", entityId: invId });
    await mkOpLog({ actorId: SYSTEM_USER_ID, action: "PAYMENT_CONFIRM", entity: "Payment", entityId: payId });
    // 另一合同的日志,不应混入
    const otherContract = await mkContract("ADM-OTHER", adminUser!.id, testCustomerId!);
    await mkOpLog({ actorId: adminUser!.id, action: "CONTRACT_UPDATE", entity: "Contract", entityId: otherContract });

    const page = await getContractOperationLogs(adminUser!, contractId, { page: 1, pageSize: 50 });
    expect(page.total).toBe(3);
    expect(page.list.length).toBe(3);
    const actions = page.list.map((l) => l.action).sort();
    expect(actions).toEqual(["CONTRACT_UPDATE", "INVOICE_ISSUE", "PAYMENT_CONFIRM"]);
    // 系统用户的 actor 标记
    const sysLog = page.list.find((l) => l.actorId === SYSTEM_USER_ID);
    expect(sysLog?.actor).toMatchObject({ isSystem: true, name: "系统" });
    // 普通用户的 actor 标记
    const adminLog = page.list.find((l) => l.actorId === adminUser!.id);
    expect(adminLog?.actor).toMatchObject({ isSystem: false });
  }));

  it("SALES 越权访问别人 owner 的合同 → 404 (不泄漏存在性)", guard(async () => {
    const otherContract = await mkContract("OWNED-BY-OTHER", salesOther!.id, testCustomer2Id!);
    await expect(
      getContractOperationLogs(salesOwner!, otherContract, { page: 1, pageSize: 50 })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.NOT_FOUND });
  }));

  it("SALES 看自己 owner 的合同 → OK 且包含关联发票/回款日志", guard(async () => {
    const contractId = await mkContract("SELF-OWNED", salesOwner!.id, testCustomerId!);
    const invId = await mkInvoice(contractId, testCustomerId!);
    await mkOpLog({ actorId: salesOwner!.id, action: "CONTRACT_UPDATE", entity: "Contract", entityId: contractId });
    await mkOpLog({ actorId: salesOwner!.id, action: "INVOICE_ISSUE", entity: "Invoice", entityId: invId });

    const page = await getContractOperationLogs(salesOwner!, contractId, { page: 1, pageSize: 50 });
    expect(page.total).toBe(2);
    expect(page.list.map((l) => l.entity).sort()).toEqual(["Contract", "Invoice"]);
  }));

  it("无关合同的日志不会混入", guard(async () => {
    const contractId = await mkContract("ISO-1", salesOwner!.id, testCustomerId!);
    // 给本合同的 Contract + 无关 Invoice(挂在其他合同上) 各写一条
    await mkOpLog({ actorId: adminUser!.id, action: "CONTRACT_UPDATE", entity: "Contract", entityId: contractId });

    const otherContract = await mkContract("ISO-2", adminUser!.id, testCustomerId!);
    const otherInv = await mkInvoice(otherContract, testCustomerId!);
    await mkOpLog({ actorId: adminUser!.id, action: "INVOICE_ISSUE", entity: "Invoice", entityId: otherInv });

    const page = await getContractOperationLogs(adminUser!, contractId, { page: 1, pageSize: 50 });
    expect(page.list.every((l) => l.entityId === contractId || l.entity === "Contract")).toBe(true);
    expect(page.list.find((l) => l.entityId === otherInv)).toBeUndefined();
  }));

  it("分页参数正确返回 total / page / pageSize", guard(async () => {
    const contractId = await mkContract("PAGE", salesOwner!.id, testCustomerId!);
    for (let i = 0; i < 5; i++) {
      await mkOpLog({ actorId: adminUser!.id, action: "CONTRACT_UPDATE", entity: "Contract", entityId: contractId });
    }
    const p1 = await getContractOperationLogs(adminUser!, contractId, { page: 1, pageSize: 2 });
    expect(p1.total).toBe(5);
    expect(p1.page).toBe(1);
    expect(p1.pageSize).toBe(2);
    expect(p1.list.length).toBe(2);

    const p3 = await getContractOperationLogs(adminUser!, contractId, { page: 3, pageSize: 2 });
    expect(p3.list.length).toBe(1);
  }));

  it("合同不存在 → 404 (SALES)", guard(async () => {
    await expect(
      getContractOperationLogs(salesOwner!, "non-existent-id", { page: 1, pageSize: 50 })
    ).rejects.toBeInstanceOf(ApiError);
  }));

  it("软关联", guard(async () => {
    const contractId = await mkContract("SOFT-DEL", salesOwner!.id, testCustomerId!);
    const inv = await prisma.invoice.create({
      data: {
        invoiceNo: `${TAG}-INV-SOFT`,
        contractId,
        customerId: testCustomerId!,
        customerName: `${TAG}-客户`,
        invoiceType: "VAT_GENERAL",
        amount: 100,
        taxRate: 0.06,
        taxAmount: 6,
        amountExcludingTax: 94,
        applyDate: new Date("2026-01-01T00:00:00Z"),
        titleType: "COMPANY",
        titleName: "x",
        status: "ISSUED",
        applicantUserId: adminUser!.id,
        createdById: adminUser!.id,
        updatedById: adminUser!.id,
        deletedAt: new Date(),
      },
      select: { id: true },
    });
    cleanupInvoiceIds.push(inv.id);
    await mkOpLog({ actorId: adminUser!.id, action: "INVOICE_ISSUE", entity: "Invoice", entityId: inv.id });

    const page = await getContractOperationLogs(adminUser!, contractId, { page: 1, pageSize: 50 });
    // 软删的发票不计入 OR 分支,日志不应出现
    expect(page.list.find((l) => l.entityId === inv.id)).toBeUndefined();
  }));
});
