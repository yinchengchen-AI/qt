// 催收记录 (DunningNote) — service + API 集成测试
//
// 覆盖:
//   1) createDunningNote: SALES 看不到他人的发票 -> 404
//   2) createDunningNote: PROMISED 状态必须带 promisedDate -> 400
//   3) createDunningNote: 正常流程, 写库 + 行级隔离读出
//   4) updateDunningNote: 修改 status / promisedDate
//   5) deleteDunningNote: SALES 看不到他人的催收 -> 404
//   6) getDunningSummary: byStatus 计数正确
//
// DB 不可达时整组 skip.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  createDunningNote,
  listDunningNotes,
  updateDunningNote,
  deleteDunningNote,
  getDunningSummary
} from "@/server/services/dunning";
import { createInvoice, invoiceAction } from "@/server/services/invoice";

let dbReachable = false;
const TAG = `TEST-DUN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: SessionUser | null = null;
let financeUser: SessionUser | null = null;
let salesUser: SessionUser | null = null;
let otherSalesUser: SessionUser | null = null;
let testCustomerId: string | null = null;
const createdContractNos: string[] = [];
const createdInvoiceIds: string[] = [];
const createdNoteIds: string[] = [];

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return adminUser;
};
const buildFinance = (): SessionUser => {
  if (!financeUser) throw new Error("finance not bootstrapped");
  return financeUser;
};
const buildSales = (): SessionUser => {
  if (!salesUser) throw new Error("sales not bootstrapped");
  return salesUser;
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
  const financeRow = await prisma.user.findFirst({ where: { role: { code: "FINANCE" }, deletedAt: null } });
  const salesRows = await prisma.user.findMany({ where: { role: { code: "SALES" }, deletedAt: null, isSystem: false }, take: 2 });
  if (!adminRow || !financeRow || salesRows.length < 2) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN", permissions: [] };
  financeUser = { id: financeRow.id, employeeNo: financeRow.employeeNo, name: financeRow.name, email: financeRow.email, roleCode: "FINANCE", permissions: [] };
  salesUser = { id: salesRows[0]!.id, employeeNo: salesRows[0]!.employeeNo, name: salesRows[0]!.name, email: salesRows[0]!.email, roleCode: "SALES", permissions: [] };
  otherSalesUser = { id: salesRows[1]!.id, employeeNo: salesRows[1]!.employeeNo, name: salesRows[1]!.name, email: salesRows[1]!.email, roleCode: "SALES", permissions: [] };

  const cust = await prisma.customer.create({
    data: {
      code: `${TAG}-CUST`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000000",
      ownerUserId: salesUser!.id, // 属于第一个 SALES
      createdById: adminUser!.id,
      updatedById: adminUser!.id
    }
  });
  testCustomerId = cust.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  if (createdNoteIds.length > 0) {
    await prisma.dunningNote.deleteMany({ where: { id: { in: createdNoteIds } } });
  }
  if (createdInvoiceIds.length > 0) {
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
  if (testCustomerId) {
    await prisma.customer.deleteMany({ where: { id: testCustomerId } });
  }
});

async function makeIssuedInvoiceFor(contractId: string, ownerId: string, amount: number, suffix: string) {
  const created = await createInvoice(buildAdmin(), {
    contractId,
    invoiceNo: `${TAG}-INV-${suffix}`,
    invoiceType: "VAT_SPECIAL",
    amount,
    taxRate: 0.06,
    applyDate: new Date().toISOString(),
    titleType: "COMPANY",
    titleName: `${TAG}-抬头`,
    taxNo: "91110000123456789X",
    attachments: []
  });
  if (!created) throw new Error("createInvoice returned null");
  await invoiceAction(buildAdmin(), created.id, { action: "submit" });
  await invoiceAction(buildFinance(), created.id, {
    action: "issue",
    actualIssueDate: new Date(Date.now() - 90 * 86400_000).toISOString()
  });
  createdInvoiceIds.push(created.id);
  return created;
}

async function makeContractFor(ownerId: string, signerId: string, suffix: string) {
  const ctr = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-CTR-${suffix}`,
      customerId: testCustomerId!,
      customerName: `${TAG}-客户`,
      title: `${TAG}-title-${suffix}`,
      serviceType: "OTHER",
      signDate: new Date(Date.now() - 120 * 86400_000),
      startDate: new Date(Date.now() - 120 * 86400_000),
      endDate: new Date(Date.now() + 365 * 86400_000),
      totalAmount: 10000,
      taxRate: 0.06,
      taxAmount: 566.04,
      amountExcludingTax: 9433.96,
      paymentMethod: "LUMP_SUM",
      installmentPlan: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["installmentPlan"],
      status: "ACTIVE",
      ownerUserId: ownerId,
      signerId,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: ownerId,
      updatedById: ownerId
    }
  });
  createdContractNos.push(ctr.contractNo);
  return ctr;
}

describe("createDunningNote", () => {
  it("正常流程: 创建后 listNotes 能拿到", async () => {
    if (!dbReachable || !adminUser || !salesUser) return;
    const ctr = await makeContractFor(salesUser.id, salesUser.id, "c-1");
    const inv = await makeIssuedInvoiceFor(ctr.id, salesUser.id, 1000, "c-1");
    const created = await createDunningNote(buildSales(), {
      invoiceId: inv.id,
      status: "CONTACTED",
      lastContactAt: new Date().toISOString(),
      channel: "PHONE",
      remark: "首次联系"
    });
    createdNoteIds.push(created.id);
    expect(created.status).toBe("CONTACTED");
    expect(created.invoiceId).toBe(inv.id);

    const list = await listDunningNotes(buildSales(), { invoiceId: inv.id });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((n) => n.id === created.id)).toBe(true);
  });

  it("PROMISED 状态必须带 promisedDate", async () => {
    if (!dbReachable || !adminUser || !salesUser) return;
    const ctr = await makeContractFor(salesUser.id, salesUser.id, "c-2");
    const inv = await makeIssuedInvoiceFor(ctr.id, salesUser.id, 1000, "c-2");
    await expect(
      createDunningNote(buildSales(), {
        invoiceId: inv.id,
        status: "PROMISED",
        lastContactAt: new Date().toISOString(),
        channel: "PHONE"
      })
    ).rejects.toThrow(/必须填写承诺付款日/);
  });

  it("另一个 SALES 看不到不属于自己的发票 (assertInvoiceAccess -> 404)", async () => {
    if (!dbReachable || !adminUser || !salesUser || !otherSalesUser) return;
    const ctr = await makeContractFor(salesUser.id, salesUser.id, "c-3");
    const inv = await makeIssuedInvoiceFor(ctr.id, salesUser.id, 1000, "c-3");
    await expect(
      createDunningNote(otherSalesUser, {
        invoiceId: inv.id,
        status: "CONTACTED",
        lastContactAt: new Date().toISOString(),
        channel: "PHONE"
      })
    ).rejects.toThrow(/发票不存在或无权限/);
  });
});

describe("updateDunningNote", () => {
  it("修改状态 + 承诺日, 持久化生效", async () => {
    if (!dbReachable || !adminUser || !salesUser) return;
    const ctr = await makeContractFor(salesUser.id, salesUser.id, "u-1");
    const inv = await makeIssuedInvoiceFor(ctr.id, salesUser.id, 1000, "u-1");
    const created = await createDunningNote(buildSales(), {
      invoiceId: inv.id,
      status: "CONTACTED",
      lastContactAt: new Date().toISOString(),
      channel: "PHONE"
    });
    createdNoteIds.push(created.id);
    const updated = await updateDunningNote(buildSales(), created.id, {
      status: "PROMISED",
      promisedDate: new Date(Date.now() + 14 * 86400_000).toISOString()
    });
    expect(updated.status).toBe("PROMISED");
    expect(updated.promisedDate).not.toBeNull();
  });
});

describe("deleteDunningNote", () => {
  it("另一个 SALES 删除不属于自己的催收 -> 404", async () => {
    if (!dbReachable || !adminUser || !salesUser || !otherSalesUser) return;
    const ctr = await makeContractFor(salesUser.id, salesUser.id, "d-1");
    const inv = await makeIssuedInvoiceFor(ctr.id, salesUser.id, 1000, "d-1");
    const created = await createDunningNote(buildSales(), {
      invoiceId: inv.id,
      status: "CONTACTED",
      lastContactAt: new Date().toISOString(),
      channel: "PHONE"
    });
    createdNoteIds.push(created.id);
    await expect(deleteDunningNote(otherSalesUser, created.id)).rejects.toThrow(/催收记录不存在或无权限/);
    // 但 owner 自己能删
    await deleteDunningNote(buildSales(), created.id);
    // 同步从 cleanup 列表去掉, 避免外层 afterAll 重复删
    const idx = createdNoteIds.indexOf(created.id);
    if (idx >= 0) createdNoteIds.splice(idx, 1);
  });
});

describe("getDunningSummary", () => {
  it("byStatus 计数与实际最新一条催收状态一致", async () => {
    if (!dbReachable || !adminUser || !salesUser) return;
    const ctr = await makeContractFor(salesUser.id, salesUser.id, "s-1");
    const inv1 = await makeIssuedInvoiceFor(ctr.id, salesUser.id, 1000, "s-1a");
    const inv2 = await makeIssuedInvoiceFor(ctr.id, salesUser.id, 1000, "s-1b");
    const n1 = await createDunningNote(buildSales(), {
      invoiceId: inv1.id,
      status: "CONTACTED",
      lastContactAt: new Date().toISOString(),
      channel: "PHONE"
    });
    const n2 = await createDunningNote(buildSales(), {
      invoiceId: inv2.id,
      status: "PROMISED",
      promisedDate: new Date(Date.now() + 7 * 86400_000).toISOString(),
      lastContactAt: new Date().toISOString(),
      channel: "WECHAT"
    });
    createdNoteIds.push(n1.id, n2.id);
    const summary = await getDunningSummary(buildSales());
    expect(summary.byStatus.CONTACTED).toBeGreaterThanOrEqual(1);
    expect(summary.byStatus.PROMISED).toBeGreaterThanOrEqual(1);
    expect(summary.withDunning).toBeGreaterThanOrEqual(2);
  });
});
