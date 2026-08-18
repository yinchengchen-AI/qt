// Phase 3 联动自动化补盲集成测试
//
// 覆盖:
//   纯函数边界:
//   1) isNoInvoiceOverdue: 非 ACTIVE / 有发票 / 恰好 -30d / -29d
//   2) isInvoicePaymentGap: 非 ACTIVE / <1万 / 恰好 20% / 发票太新 / 全条件命中
//   job (daily-linkage-check):
//   3) 超期未开票 → LINKAGE_NO_INVOICE 只发 owner; 偏差 → LINKAGE_INVOICE_PAYMENT_GAP 发 owner+财务
//   4) 同日重跑不重复 (entityKey 日去重)
//   5) 各不触发场景无消息 (新合同 / 小缺口 / 发票太新 / 小额)
//   overview 透出:
//   6) warnings 与 job 同源判定; 续签链 renewedFrom / renewals
//
// 并发隔离: 新建专属 SALES 用户. DB 不可达时整组 skip, TAG 前缀 + 自清理.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/session";
import {
  isNoInvoiceOverdue,
  isInvoicePaymentGap,
  NO_INVOICE_DAYS,
  GAP_MIN_INVOICED,
  GAP_MIN_INVOICE_AGE_DAYS
} from "@/server/services/contract/linkage-checks";
import { runDailyLinkageCheck } from "@/server/jobs/daily-linkage-check";
import { getContractOverview } from "@/server/services/contract";

let dbReachable = false;
const TAG = `TEST-LINK-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const DAY_MS = 86_400_000;
const NOW = new Date();

let salesUser: SessionUser | null = null;
let salesId = "";
let customerId: string | null = null;
let cNoInvoiceId: string | null = null;
let cGapId: string | null = null;
let cGapSmallId: string | null = null;
let cGapYoungId: string | null = null;
let cLowAmountId: string | null = null;
let cNewId: string | null = null;
let cRenewalTargetId: string | null = null;
const createdInvoiceIds: string[] = [];
const createdPaymentIds: string[] = [];
let renewalContractId: string | null = null;

async function createFixtureContract(startDaysAgo: number) {
  const start = new Date(NOW.getTime() - startDaysAgo * DAY_MS);
  return prisma.contract.create({
    data: {
      contractNo: `${TAG}-${Math.random().toString(36).slice(2, 8)}`,
      customerId: customerId!,
      customerName: `${TAG}-客户`,
      title: `${TAG}-合同`,
      serviceType: "OTHER",
      signDate: start,
      startDate: start,
      endDate: new Date(NOW.getTime() + 300 * DAY_MS),
      totalAmount: 100000,
      taxRate: 0.06,
      taxAmount: Number((100000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((100000 / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: salesId,
      signerId: salesId,
      attachments: [] as unknown as Prisma.InputJsonValue,
      createdById: salesId,
      updatedById: salesId
    }
  });
}

async function createIssuedInvoice(contractId: string, amount: number, issueDaysAgo: number) {
  const inv = await prisma.invoice.create({
    data: {
      invoiceNo: `${TAG}-INV-${Math.random().toString(36).slice(2, 8)}`,
      contractId,
      customerId: customerId!,
      customerName: `${TAG}-客户`,
      invoiceType: "VAT_SPECIAL",
      amount,
      taxRate: "0.0600",
      taxAmount: "0",
      amountExcludingTax: "0",
      applyDate: new Date(NOW.getTime() - issueDaysAgo * DAY_MS),
      actualIssueDate: new Date(NOW.getTime() - issueDaysAgo * DAY_MS),
      titleType: "COMPANY",
      titleName: `${TAG}-抬头`,
      taxNo: "91330000123456789X",
      status: "ISSUED",
      applicantUserId: salesId,
      financeUserId: salesId,
      attachments: [] as unknown as Prisma.InputJsonValue,
      createdById: salesId,
      updatedById: salesId
    }
  });
  createdInvoiceIds.push(inv.id);
  return inv;
}

async function createConfirmedPayment(contractId: string, amount: number) {
  const p = await prisma.payment.create({
    data: {
      paymentNo: `${TAG}-PAY-${Math.random().toString(36).slice(2, 8)}`,
      customerId: customerId!,
      contractId,
      invoiceId: null,
      amount,
      receivedAt: new Date(NOW.getTime() - 5 * DAY_MS),
      method: "BANK_TRANSFER",
      bankRefNo: `${TAG}-REF-${Math.random().toString(36).slice(2, 8)}`,
      status: "CONFIRMED",
      recorderUserId: salesId,
      createdById: salesId,
      updatedById: salesId
    }
  });
  createdPaymentIds.push(p.id);
  return p;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const salesRow = await prisma.user.create({
    data: {
      employeeNo: `${TAG}-S`,
      name: `${TAG}-销售`,
      email: `${TAG}-sales@example.com`,
      passwordHash: "not-valid",
      role: { connect: { code: "SALES" } }
    },
    select: { id: true, employeeNo: true, name: true, email: true }
  });
  salesId = salesRow.id;
  salesUser = { ...salesRow, roleCode: "SALES", permissions: [] };

  const cust = await prisma.customer.create({
    data: {
      code: `${TAG}-C`,
      name: `${TAG}-客户`,
      customerType: "ENTERPRISE",
      province: "浙江省",
      city: "杭州市",
      contactPhone: "13800000666",
      ownerUserId: salesId,
      createdById: salesId,
      updatedById: salesId
    }
  });
  customerId = cust.id;

  // cNoInvoice: 生效 45 天无发票 → no_invoice 消息
  cNoInvoiceId = (await createFixtureContract(45)).id;
  // cGap: 生效 45 天, 已开票 20000 (40 天前), 零回款 → 缺口 100% → gap 消息
  cGapId = (await createFixtureContract(45)).id;
  await createIssuedInvoice(cGapId, 20000, 40);
  // cGapSmall: 开票 20000 (40 天前), 回款 17000 → 缺口 15% < 20% → 无消息
  cGapSmallId = (await createFixtureContract(45)).id;
  await createIssuedInvoice(cGapSmallId, 20000, 40);
  await createConfirmedPayment(cGapSmallId, 17000);
  // cGapYoung: 开票 20000 但 10 天前 → 发票太新 → 无消息
  cGapYoungId = (await createFixtureContract(45)).id;
  await createIssuedInvoice(cGapYoungId, 20000, 10);
  // cLowAmount: 开票 5000 (<1万) → 无消息
  cLowAmountId = (await createFixtureContract(45)).id;
  await createIssuedInvoice(cLowAmountId, 5000, 40);
  // cNew: 生效 10 天 → 无 no_invoice 消息
  cNewId = (await createFixtureContract(10)).id;
  // cRenewalTarget + 续签合同: overview 续签链透出验证
  cRenewalTargetId = (await createFixtureContract(45)).id;
  const renewal = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-RENEWAL`,
      customerId: customerId!,
      customerName: `${TAG}-客户`,
      title: `${TAG}-续签`,
      serviceType: "OTHER",
      signDate: NOW,
      startDate: NOW,
      endDate: new Date(NOW.getTime() + 300 * DAY_MS),
      totalAmount: 100000,
      taxRate: 0.06,
      taxAmount: Number((100000 * 0.06 / 1.06).toFixed(2)),
      amountExcludingTax: Number((100000 / 1.06).toFixed(2)),
      paymentMethod: "LUMP_SUM",
      status: "DRAFT",
      ownerUserId: salesId,
      signerId: salesId,
      renewedFromId: cRenewalTargetId,
      attachments: [] as unknown as Prisma.InputJsonValue,
      createdById: salesId,
      updatedById: salesId
    }
  });
  renewalContractId = renewal.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    const ids = [cNoInvoiceId, cGapId, cGapSmallId, cGapYoungId, cLowAmountId, cNewId, cRenewalTargetId, renewalContractId]
      .filter((x): x is string => !!x);
    await prisma.message.deleteMany({ where: { OR: ids.map((id) => ({ entityKey: { contains: id } })) } });
    if (createdPaymentIds.length > 0) await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
    if (createdInvoiceIds.length > 0) {
      await prisma.invoiceAuditLog.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } }).catch(() => {});
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (ids.length > 0) await prisma.contract.deleteMany({ where: { id: { in: ids } } });
    if (customerId) await prisma.customer.delete({ where: { id: customerId } });
    if (salesId) await prisma.user.delete({ where: { id: salesId } }).catch(() => {});
  } finally {
    await prisma.$disconnect();
  }
});

describe("isNoInvoiceOverdue 纯函数边界", () => {
  it("非 ACTIVE / 有发票 / 恰好 -30d / -29d", () => {
    const start = new Date(NOW.getTime() - NO_INVOICE_DAYS * DAY_MS);
    expect(isNoInvoiceOverdue({ status: "CLOSED", startDate: start }, false, NOW)).toBe(false);
    expect(isNoInvoiceOverdue({ status: "ACTIVE", startDate: start }, true, NOW)).toBe(false);
    expect(isNoInvoiceOverdue({ status: "ACTIVE", startDate: start }, false, NOW)).toBe(true);
    expect(isNoInvoiceOverdue({ status: "ACTIVE", startDate: new Date(NOW.getTime() - 29 * DAY_MS) }, false, NOW)).toBe(false);
  });
});

describe("isInvoicePaymentGap 纯函数边界", () => {
  const oldInvoice = new Date(NOW.getTime() - GAP_MIN_INVOICE_AGE_DAYS * DAY_MS);
  it("非 ACTIVE → false", () => {
    expect(isInvoicePaymentGap({ status: "CLOSED", invoicedAmount: 20000, paidAmount: 0, latestInvoiceDate: oldInvoice }, NOW)).toBe(false);
  });
  it("已开票 < 1 万 → false", () => {
    // 距阈值 1 元 (> MONEY_TOLERANCE 0.01), 明确低于阈值
    expect(isInvoicePaymentGap({ status: "ACTIVE", invoicedAmount: GAP_MIN_INVOICED - 1, paidAmount: 0, latestInvoiceDate: oldInvoice }, NOW)).toBe(false);
  });
  it("缺口恰好 20% → false (>20% 才触发)", () => {
    expect(isInvoicePaymentGap({ status: "ACTIVE", invoicedAmount: 20000, paidAmount: 16000, latestInvoiceDate: oldInvoice }, NOW)).toBe(false);
  });
  it("最新发票太新 (<30 天) → false", () => {
    const young = new Date(NOW.getTime() - (GAP_MIN_INVOICE_AGE_DAYS - 1) * DAY_MS);
    expect(isInvoicePaymentGap({ status: "ACTIVE", invoicedAmount: 20000, paidAmount: 0, latestInvoiceDate: young }, NOW)).toBe(false);
  });
  it("无已开票发票 → false", () => {
    expect(isInvoicePaymentGap({ status: "ACTIVE", invoicedAmount: 0, paidAmount: 0, latestInvoiceDate: null }, NOW)).toBe(false);
  });
  it("全条件命中 → true", () => {
    expect(isInvoicePaymentGap({ status: "ACTIVE", invoicedAmount: 20000, paidAmount: 0, latestInvoiceDate: oldInvoice }, NOW)).toBe(true);
  });
});

describe("daily-linkage-check job", () => {
  it("超期未开票 → owner 单发; 偏差 → owner+财务", async () => {
    if (!dbReachable) return;
    const r = await runDailyLinkageCheck();
    expect(r.scanned).toBeGreaterThan(0);

    const noInvoiceMsgs = await prisma.message.findMany({
      where: { type: "LINKAGE_NO_INVOICE", entityKey: { contains: cNoInvoiceId! } }
    });
    expect(noInvoiceMsgs.length).toBe(1);
    expect(noInvoiceMsgs[0]!.receiverUserId).toBe(salesId);

    const gapMsgs = await prisma.message.findMany({
      where: { type: "LINKAGE_INVOICE_PAYMENT_GAP", entityKey: { contains: cGapId! } }
    });
    expect(gapMsgs.length).toBeGreaterThanOrEqual(2);
    const receivers = new Set(gapMsgs.map((m) => m.receiverUserId));
    expect(receivers.has(salesId)).toBe(true);
    // 财务接收人存在 (seed 的 finance 账号)
    const financeRow = await prisma.user.findFirst({ where: { role: { code: "FINANCE" }, deletedAt: null, status: "ACTIVE", isSystem: false } });
    if (financeRow) expect(receivers.has(financeRow.id)).toBe(true);
  });

  it("同日重跑不重复 (entityKey 日去重)", async () => {
    if (!dbReachable) return;
    const countBefore = await prisma.message.count({
      where: { type: { in: ["LINKAGE_NO_INVOICE", "LINKAGE_INVOICE_PAYMENT_GAP"] }, entityKey: { contains: TAG } }
    });
    await runDailyLinkageCheck();
    const countAfter = await prisma.message.count({
      where: { type: { in: ["LINKAGE_NO_INVOICE", "LINKAGE_INVOICE_PAYMENT_GAP"] }, entityKey: { contains: TAG } }
    });
    expect(countAfter).toBe(countBefore);
  });

  it("不触发场景无消息 (新合同 / 小缺口 / 发票太新 / 小额)", async () => {
    if (!dbReachable) return;
    for (const id of [cNewId, cGapSmallId, cGapYoungId, cLowAmountId]) {
      const msgs = await prisma.message.findMany({
        where: { type: { in: ["LINKAGE_NO_INVOICE", "LINKAGE_INVOICE_PAYMENT_GAP"] }, entityKey: { contains: id! } }
      });
      expect(msgs.length).toBe(0);
    }
  });
});

describe("getContractOverview 透出", () => {
  it("warnings 与 job 同源: 超期未开票合同 noInvoice=true", async () => {
    if (!dbReachable || !salesUser) return;
    const ov = await getContractOverview(salesUser, cNoInvoiceId!);
    expect(ov.warnings.noInvoice).toBe(true);
    expect(ov.warnings.invoicePaymentGap).toBe(false);
  });

  it("warnings: 偏差合同 invoicePaymentGap=true", async () => {
    if (!dbReachable || !salesUser) return;
    const ov = await getContractOverview(salesUser, cGapId!);
    expect(ov.warnings.noInvoice).toBe(false);
    expect(ov.warnings.invoicePaymentGap).toBe(true);
  });

  it("续签链: 源合同见 renewals, 续签合同见 renewedFrom", async () => {
    if (!dbReachable || !salesUser) return;
    const source = await getContractOverview(salesUser, cRenewalTargetId!);
    expect(source.renewals.length).toBe(1);
    expect(source.renewals[0]!.contractNo).toBe(`${TAG}-RENEWAL`);
    const ren = await getContractOverview(salesUser, renewalContractId!);
    expect(ren.renewedFrom?.id).toBe(cRenewalTargetId);
  });
});
