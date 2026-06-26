// 合同自动关闭任务回归 (合并 tryAutoComplete + tryAutoCloseOnExpiry → tryAutoClose)
//
// 关键回归: 旧的 tryAutoCloseOnExpiry 只校验"开票足额 (>=total)" 并不查回款,
// 导致"开票开了但客户没付款"的过期合同会被自动关闭, 财务对不上账。
// 新版 tryAutoClose 统一要求"开票足额 + 回款足额", 走同一份 ratio 阈值,
// 并把 reason 由 endDate<now 自动判定为 expired / completed。
//
// 覆盖:
//   1) 未到期 + 开票+回款都足额 → CLOSED (reason=completed)
//   2) 未到期 + 开票足额 + 回款 0  → SKIPPED
//   3) 已到期 + 开票足额 + 回款 0  → SKIPPED (回归 #1: 旧版本会错误 CLOSED)
//   4) 已到期 + 开票+回款都足额   → CLOSED (reason=expired)
//
// DB 不可达时整组 skip. 全部数据用 unique TAG 前缀, 跑完自己清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { tryAutoClose } from "@/server/services/contract";

let dbReachable = false;
const TAG = `TEST-AUTOCLOSE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: { id: string } | null = null;
let testCustomerId: string | null = null;
const createdContractIds: string[] = [];
const createdInvoiceIds: string[] = [];
const createdPaymentIds: string[] = [];

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
    select: { id: true }
  });
  if (!adminRow) return;
  adminUser = { id: adminRow.id };

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
    if (createdPaymentIds.length > 0) {
      await prisma.payment.deleteMany({ where: { id: { in: createdPaymentIds } } });
    }
    if (createdInvoiceIds.length > 0) {
      await prisma.invoiceAuditLog.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdContractIds.length > 0) {
      await prisma.contractReviewLog.deleteMany({ where: { contractId: { in: createdContractIds } } });
      await prisma.contract.deleteMany({ where: { id: { in: createdContractIds } } });
    }
    if (testCustomerId) {
      await prisma.customer.delete({ where: { id: testCustomerId } });
    }
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const setup = () => {
  if (!dbReachable || !adminUser || !testCustomerId) return null;
  return { adminId: adminUser.id, customerId: testCustomerId };
};

async function mkContract(opts: { endDate: Date; totalAmount: string; suffix: string }) {
  const s = setup();
  if (!s) throw new Error("setup not ready");
  const c = await prisma.contract.create({
    data: {
      contractNo: `${TAG}-${opts.suffix}`,
      customerId: s.customerId,
      customerName: `${TAG}-客户`,
      title: `${TAG}-title-${opts.suffix}`,
      serviceType: "OTHER",
      signDate: new Date("2026-01-01T00:00:00Z"),
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: opts.endDate,
      totalAmount: opts.totalAmount,
      taxRate: "0.06",
      taxAmount: "0",
      amountExcludingTax: "0",
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: s.adminId,
      signerId: s.adminId,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: s.adminId,
      updatedById: s.adminId
    }
  });
  createdContractIds.push(c.id);
  return c;
}

async function mkIssuedInvoice(contractId: string, amount: string, suffix: string) {
  const s = setup();
  if (!s) throw new Error("setup not ready");
  const inv = await prisma.invoice.create({
    data: {
      invoiceNo: `${TAG}-INV-${suffix}`,
      contractId,
      customerId: s.customerId,
      customerName: `${TAG}-客户`,
      invoiceType: "VAT_SPECIAL",
      amount,
      taxRate: "0.0600",
      taxAmount: "0",
      amountExcludingTax: "0",
      applyDate: new Date("2026-01-15T00:00:00Z"),
      actualIssueDate: new Date("2026-01-20T00:00:00Z"),
      titleType: "COMPANY",
      titleName: `${TAG}-抬头`,
      taxNo: "91330000123456789X",
      status: "ISSUED",
      applicantUserId: s.adminId,
      financeUserId: s.adminId,
      attachments: [] as unknown as Parameters<typeof prisma.invoice.create>[0]["data"]["attachments"],
      createdById: s.adminId,
      updatedById: s.adminId
    }
  });
  createdInvoiceIds.push(inv.id);
  return inv;
}

async function mkReconciledPayment(contractId: string, invoiceId: string | null, amount: string, suffix: string) {
  const s = setup();
  if (!s) throw new Error("setup not ready");
  const p = await prisma.payment.create({
    data: {
      paymentNo: `${TAG}-PAY-${suffix}`,
      customerId: s.customerId,
      contractId,
      invoiceId,
      amount,
      receivedAt: new Date("2026-01-25T00:00:00Z"),
      method: "BANK_TRANSFER",
      bankRefNo: `${TAG}-REF-${suffix}`,
      status: "RECONCILED",
      reconcileUserId: s.adminId,
      reconciledAt: new Date("2026-01-26T00:00:00Z"),
      recorderUserId: s.adminId,
      createdById: s.adminId,
      updatedById: s.adminId
    }
  });
  createdPaymentIds.push(p.id);
  return p;
}

const futureEndDate = new Date("2026-12-31T00:00:00Z");
const pastEndDate = new Date("2025-06-30T00:00:00Z");

describe("tryAutoClose — 合并 tryAutoComplete + tryAutoCloseOnExpiry", () => {
  it("未到期 + 开票+回款都足额 → CLOSED, reason=completed", async () => {
    if (!dbReachable) return;
    const c = await mkContract({ endDate: futureEndDate, totalAmount: "1000.00", suffix: "A1" });
    await mkIssuedInvoice(c.id, "1000.00", "A1");
    await mkReconciledPayment(c.id, null, "1000.00", "A1");

    const r = await tryAutoClose(c.id, new Date("2026-06-26T00:00:00Z"));
    expect(r).toBe("CLOSED");

    const after = await prisma.contract.findUnique({ where: { id: c.id }, select: { status: true, reviewComment: true } });
    expect(after?.status).toBe("CLOSED");
    expect(after?.reviewComment).toBe("completed");
  });

  it("未到期 + 开票足额 + 回款 0 → SKIPPED (回款足额是硬性条件)", async () => {
    if (!dbReachable) return;
    const c = await mkContract({ endDate: futureEndDate, totalAmount: "1000.00", suffix: "A2" });
    await mkIssuedInvoice(c.id, "1000.00", "A2");
    // 故意不建任何回款

    const r = await tryAutoClose(c.id, new Date("2026-06-26T00:00:00Z"));
    expect(r).toBe("SKIPPED");

    const after = await prisma.contract.findUnique({ where: { id: c.id }, select: { status: true } });
    expect(after?.status).toBe("ACTIVE");
  });

  it("已到期 + 开票足额 + 回款 0 → SKIPPED (回归: 旧 tryAutoCloseOnExpiry 错关)", async () => {
    if (!dbReachable) return;
    const c = await mkContract({ endDate: pastEndDate, totalAmount: "1000.00", suffix: "A3" });
    await mkIssuedInvoice(c.id, "1000.00", "A3");
    // 故意不建回款 — 旧版会因"开票足额 + 已过期"就 CLOSED, 新版必须等回款

    const r = await tryAutoClose(c.id, new Date("2026-06-26T00:00:00Z"));
    expect(r).toBe("SKIPPED");

    const after = await prisma.contract.findUnique({ where: { id: c.id }, select: { status: true } });
    expect(after?.status).toBe("ACTIVE");
  });

  it("已到期 + 开票+回款都足额 → CLOSED, reason=expired", async () => {
    if (!dbReachable) return;
    const c = await mkContract({ endDate: pastEndDate, totalAmount: "1000.00", suffix: "A4" });
    await mkIssuedInvoice(c.id, "1000.00", "A4");
    await mkReconciledPayment(c.id, null, "1000.00", "A4");

    const r = await tryAutoClose(c.id, new Date("2026-06-26T00:00:00Z"));
    expect(r).toBe("CLOSED");

    const after = await prisma.contract.findUnique({ where: { id: c.id }, select: { status: true, reviewComment: true } });
    expect(after?.status).toBe("CLOSED");
    expect(after?.reviewComment).toBe("expired");
  });

  it("未到期 + 开票 0 + 回款足额 → SKIPPED (开票也必须足额, 双足额硬要求)", async () => {
    if (!dbReachable) return;
    const c = await mkContract({ endDate: futureEndDate, totalAmount: "1000.00", suffix: "A5" });
    // 不建任何发票
    await mkReconciledPayment(c.id, null, "1000.00", "A5");

    const r = await tryAutoClose(c.id, new Date("2026-06-26T00:00:00Z"));
    expect(r).toBe("SKIPPED");

    const after = await prisma.contract.findUnique({ where: { id: c.id }, select: { status: true } });
    expect(after?.status).toBe("ACTIVE");
  });
});
