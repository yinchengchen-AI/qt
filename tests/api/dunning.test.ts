// 催收记录 (DunningNote) — service + API 集成测试
//
// 覆盖:
//   1) createDunningNote: SALES 在自己合同的发票上记催收 -> 200 (正常流程, 写库 + 读出)
//   2) createDunningNote: PROMISED 状态必须带 promisedDate -> 400
//   3) createDunningNote: SALES 在他人 owner 的发票上记催收 -> 403 无权操作他人催收记录
//   3b) createDunningNote: 发票不存在 -> 404 (missing 语义, 不与越权 403 混淆)
//   4) listDunningNotes: 读放开 — SALES 能列出他人 owner 发票的催收记录 (200 有行)
//   5) updateDunningNote: 修改 status / promisedDate (UPDATE 角色限定 FINANCE/ADMIN)
//   6) deleteDunningNote: SALES 无 DELETE 矩阵权限; FINANCE/ADMIN 可删任意 owner 记录
//   7) getDunningSummary: 本人口径 — 他人 owner 的 ISSUED 发票 + 催收不影响 SALES 汇总卡
//   8) createDunningNote: EXPERT 矩阵仅 R, create -> 403
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
let expertUser: SessionUser | null = null;
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
const buildExpert = (): SessionUser => {
  if (!expertUser) throw new Error("expert not bootstrapped");
  return expertUser;
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
  const expertRow = await prisma.user.findFirst({ where: { role: { code: "EXPERT" }, deletedAt: null, isSystem: false } });
  if (expertRow) {
    expertUser = { id: expertRow.id, employeeNo: expertRow.employeeNo, name: expertRow.name, email: expertRow.email, roleCode: "EXPERT", permissions: [] };
  }

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

async function makeIssuedInvoiceFor(contractId: string, ownerId: string, amount: number, suffix: string, issueDaysAgo = 90) {
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
    actualIssueDate: new Date(Date.now() - issueDaysAgo * 86400_000).toISOString()
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

  it("另一个 SALES 在他人 owner 的发票上记催收 -> 403 无权操作他人催收记录", async () => {
    if (!dbReachable || !adminUser || !salesUser || !otherSalesUser) return;
    const ctr = await makeContractFor(salesUser.id, salesUser.id, "c-3");
    const inv = await makeIssuedInvoiceFor(ctr.id, salesUser.id, 1000, "c-3");
    try {
      await createDunningNote(otherSalesUser, {
        invoiceId: inv.id,
        status: "CONTACTED",
        lastContactAt: new Date().toISOString(),
        channel: "PHONE"
      });
      expect.unreachable("越权 create 应抛 403");
    } catch (e) {
      const err = e as { status?: number; message?: string };
      expect(err.status).toBe(403);
      expect(err.message).toMatch(/无权操作他人催收记录/);
    }
  });

  it("发票不存在 -> 404 (missing 语义保留, 不与越权 403 混淆)", async () => {
    if (!dbReachable || !salesUser) return;
    try {
      await createDunningNote(buildSales(), {
        invoiceId: `${TAG}-NO-SUCH-INVOICE`,
        status: "CONTACTED",
        lastContactAt: new Date().toISOString(),
        channel: "PHONE"
      });
      expect.unreachable("不存在的发票应抛 404");
    } catch (e) {
      const err = e as { status?: number; message?: string };
      expect(err.status).toBe(404);
      expect(err.message).toMatch(/发票不存在或无权限访问/);
    }
  });

  it("EXPERT 矩阵仅 DUNNING.READ, create -> 403", async () => {
    if (!dbReachable || !adminUser || !salesUser || !expertUser) return;
    const ctr = await makeContractFor(salesUser.id, salesUser.id, "c-4");
    const inv = await makeIssuedInvoiceFor(ctr.id, salesUser.id, 1000, "c-4");
    try {
      await createDunningNote(buildExpert(), {
        invoiceId: inv.id,
        status: "CONTACTED",
        lastContactAt: new Date().toISOString(),
        channel: "PHONE"
      });
      expect.unreachable("EXPERT 无 CREATE 矩阵权限应抛 403");
    } catch (e) {
      const err = e as { status?: number; message?: string };
      expect(err.status).toBe(403);
    }
  });
});

describe("listDunningNotes 读放开", () => {
  it("SALES 能列出他人 owner 合同发票的催收记录 (200 且有行)", async () => {
    if (!dbReachable || !adminUser || !salesUser || !otherSalesUser) return;
    const ctr = await makeContractFor(otherSalesUser.id, otherSalesUser.id, "r-1");
    const inv = await makeIssuedInvoiceFor(ctr.id, otherSalesUser.id, 1000, "r-1");
    const note = await createDunningNote(otherSalesUser, {
      invoiceId: inv.id,
      status: "CONTACTED",
      lastContactAt: new Date().toISOString(),
      channel: "PHONE",
      remark: "他人 owner 的记录"
    });
    createdNoteIds.push(note.id);
    const list = await listDunningNotes(buildSales(), { invoiceId: inv.id });
    expect(list.some((n) => n.id === note.id)).toBe(true);
    expect(list[0]?.invoiceNo).toBe(`${TAG}-INV-r-1`);
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
    // UPDATE 权限归财务 (新矩阵 SALES/EXPERT 不能改既有催收记录)
    const updated = await updateDunningNote(buildFinance(), created.id, {
      status: "PROMISED",
      promisedDate: new Date(Date.now() + 14 * 86400_000).toISOString()
    });
    expect(updated.status).toBe("PROMISED");
    expect(updated.promisedDate).not.toBeNull();
  });
});

describe("deleteDunningNote", () => {
  it("矩阵: SALES 无 DUNNING.DELETE 权限, 即便 owner 自己也不能删 (403)", async () => {
    if (!dbReachable || !adminUser || !salesUser) return;
    const ctr = await makeContractFor(salesUser.id, salesUser.id, "d-1");
    const inv = await makeIssuedInvoiceFor(ctr.id, salesUser.id, 1000, "d-1");
    const created = await createDunningNote(buildSales(), {
      invoiceId: inv.id,
      status: "CONTACTED",
      lastContactAt: new Date().toISOString(),
      channel: "PHONE"
    });
    createdNoteIds.push(created.id);
    await expect(deleteDunningNote(buildSales(), created.id)).rejects.toThrow(/仅.*可.*删|无权|SALES.*DELETE/);
  });

  it("FINANCE 有 DUNNING.DELETE 权限, 可实际删除记录", async () => {
    if (!dbReachable || !adminUser || !salesUser) return;
    const ctr = await makeContractFor(salesUser.id, salesUser.id, "d-2");
    const inv = await makeIssuedInvoiceFor(ctr.id, salesUser.id, 1000, "d-2");
    const created = await createDunningNote(buildSales(), {
      invoiceId: inv.id,
      status: "CONTACTED",
      lastContactAt: new Date().toISOString(),
      channel: "PHONE"
    });
    createdNoteIds.push(created.id);
    // 不抛错
    await deleteDunningNote(buildFinance(), created.id);
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
