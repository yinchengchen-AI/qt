// 回款金额逻辑回归 (P1-2, P1-4, P1-5, P2-1, P2-2)
//
// 覆盖:
//   1) confirm: R-10 PLANNED 同号不互锁, CONFIRMED 同号抛 PAYMENT_DUPLICATE_REF (P1-4)
//   2) confirm: R-11 0.01 容差内通过, 超容差抛 PAYMENT_OVER_INVOICE (P2-1/P2-2)
//   3) confirm: R-12 超合同总额抛 PAYMENT_OVER_CONTRACT
//   4) refund 缺 reason → VALIDATION_FAILED
//   5) refund 填 reason → 原 payment 翻 REFUNDED, 不创建负数补偿 (P1-2)
//   6) refund 后 R-12 累计下降, 后续可继续 confirm (P1-2 回归)
//
// DB 不可达时整组 skip. 全部数据用 unique TAG 前缀, 跑完自己清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { paymentAction } from "@/server/services/payment";
import { createInvoice, invoiceAction } from "@/server/services/invoice";
import { nextBusinessNo } from "@/lib/sequence";

let dbReachable = false;
const TAG = `TEST-PAY-AMT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdInvoiceIds: string[] = [];
const createdContractNos: string[] = [];
const createdPaymentIds: string[] = [];
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let financeUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "FINANCE" } | null = null;
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
  const financeRow = await prisma.user.findFirst({
    where: { role: { code: "FINANCE" }, deletedAt: null },
    select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
  });
  if (!adminRow || !financeRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN" };
  financeUser = { id: financeRow.id, employeeNo: financeRow.employeeNo, name: financeRow.name, email: financeRow.email, roleCode: "FINANCE" };
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
    if (createdContractNos.length > 0) {
      await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
    }
    if (testCustomerId) {
      await prisma.customer.delete({ where: { id: testCustomerId } });
    }
    await prisma.operationLog.deleteMany({ where: { entity: "Payment", action: { in: ["PAYMENT_REFUND", "PAYMENT_CONFIRM"] } } });
  } catch {
    // ignore
  }
  await prisma.$disconnect();
});

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable) return;
  if (!adminUser || !financeUser || !testCustomerId) return;
  await fn();
};

const buildAdmin = (): SessionUser => {
  if (!adminUser) throw new Error("admin not bootstrapped");
  return { id: adminUser.id, employeeNo: adminUser.employeeNo, name: adminUser.name, email: adminUser.email, roleCode: "ADMIN", permissions: [] };
};
const buildFinance = (): SessionUser => {
  if (!financeUser) throw new Error("finance not bootstrapped");
  return { id: financeUser.id, employeeNo: financeUser.employeeNo, name: financeUser.name, email: financeUser.email, roleCode: "FINANCE", permissions: [] };
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


// 把任意字符串映射成 20 位纯数字 (电子发票号要求 \d{20})
function digits20(s: string): string {
  const out = s
    .split("")
    .map((c) => (c.charCodeAt(0) % 10).toString())
    .join("")
    .slice(0, 20);
  return out.padEnd(20, "0");
}

async function mkIssuedInvoice(contractId: string, amount: number, suffix: string) {
  const inv = await createInvoice(buildAdmin(), {
    contractId,
    invoiceNo: `${TAG}-INV-${suffix}`,
    invoiceType: "VAT_SPECIAL",
    amount,
    taxRate: 0.06,
    applyDate: new Date().toISOString(),
    titleType: "COMPANY",
    titleName: `${TAG}-抬头`,
    taxNo: "91330000123456789X",
    attachments: []
  });
  if (!inv) throw new Error("createInvoice returned null");
  createdInvoiceIds.push(inv.id);
  await invoiceAction(buildFinance(), inv.id, { action: "submit" });
  const invoiceNo20 = digits20(`${TAG}I${suffix}`);
  await invoiceAction(buildFinance(), inv.id, { action: "issue", invoiceNo: invoiceNo20, actualIssueDate: new Date().toISOString() });
  // issue 会自动创建一笔 PLANNED 回款, 收集 id 便于 afterAll 清理
  const planned = await prisma.payment.findFirst({
    where: { invoiceId: inv.id, status: "PLANNED", deletedAt: null }
  });
  if (planned) createdPaymentIds.push(planned.id);
  return inv;
}

async function mkPlannedPayment(contractId: string, invoiceId: string | null, amount: number, refNo: string) {
  if (!adminUser || !testCustomerId) throw new Error("setup not ready");
  const paymentNo = await nextBusinessNo("PAYMENT");
  const p = await prisma.payment.create({
    data: {
      paymentNo,
      customerId: testCustomerId,
      contractId,
      invoiceId,
      amount: amount.toString(),
      receivedAt: new Date(),
      method: "BANK_TRANSFER",
      status: "PLANNED",
      bankRefNo: refNo,
      recorderUserId: adminUser.id,
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
  createdPaymentIds.push(p.id);
  return p;
}

describe("paymentAction.confirm 校验", () => {
  it("PLANNED 同号可并存, CONFIRMED 同号拒 (P1-4)", guard(async () => {
    const c = await mkContract("1000.00", "R10");
    const ref = `${TAG}-R10-1`;
    const p1 = await mkPlannedPayment(c.id, null, 50, ref);
    // p1 还在 PLANNED, 直接 confirm
    await paymentAction(buildFinance(), p1.id, { action: "confirm", bankRefNo: ref });
    // 再造一个 PLANNED 用同号 — 旧实现会拒, 新实现应放行
    const p2 = await mkPlannedPayment(c.id, null, 60, ref);
    await expect(
      paymentAction(buildFinance(), p2.id, { action: "confirm", bankRefNo: ref })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.PAYMENT_DUPLICATE_REF });
  }));

  it("R-11 0.01 容差内通过, 超容差拒 (P2-1/P2-2)", guard(async () => {
    const c = await mkContract("100.00", "R11");
    const inv = await mkIssuedInvoice(c.id, 100, "R11");
    const ref1 = `${TAG}-R11-A`;
    const ref2 = `${TAG}-R11-B`;
    // 第一笔 99.99, 在 100 容差内 → 通过
    const p1 = await mkPlannedPayment(c.id, inv.id, 99.99, ref1);
    await expect(
      paymentAction(buildFinance(), p1.id, { action: "confirm", bankRefNo: ref1 })
    ).resolves.toBeTruthy();
    // 第二笔 0.02 → 总 100.01, 恰好等于 100 + 0.01 容差上限, 应当通过
    // (0.01 容差是为了抵消浮点失真, 100.01 在容差内合法)
    const p2 = await mkPlannedPayment(c.id, inv.id, 0.02, ref2);
    await expect(
      paymentAction(buildFinance(), p2.id, { action: "confirm", bankRefNo: ref2 })
    ).resolves.toBeTruthy();
    // 第三笔 0.01 → 总 100.02, 超出 100 + 0.01 = 100.01 容差上限, 应拒
    const ref3 = `${TAG}-R11-C`;
    const p3 = await mkPlannedPayment(c.id, inv.id, 0.01, ref3);
    await expect(
      paymentAction(buildFinance(), p3.id, { action: "confirm", bankRefNo: ref3 })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.PAYMENT_OVER_INVOICE });
  }));

  it("R-12 超合同总额 → 抛 PAYMENT_OVER_CONTRACT", guard(async () => {
    const c = await mkContract("50.00", "R12");
    const ref1 = `${TAG}-R12-A`;
    const p1 = await mkPlannedPayment(c.id, null, 50, ref1);
    await paymentAction(buildFinance(), p1.id, { action: "confirm", bankRefNo: ref1 });
    const ref2 = `${TAG}-R12-B`;
    const p2 = await mkPlannedPayment(c.id, null, 1, ref2);
    await expect(
      paymentAction(buildFinance(), p2.id, { action: "confirm", bankRefNo: ref2 })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.PAYMENT_OVER_CONTRACT });
  }));
});

describe("paymentAction.refund P1-2", () => {
  it("缺 reason → VALIDATION_FAILED", guard(async () => {
    const c = await mkContract("100.00", "REF-NOREASON");
    const ref = `${TAG}-REF-NR`;
    const p = await mkPlannedPayment(c.id, null, 30, ref);
    await paymentAction(buildFinance(), p.id, { action: "confirm", bankRefNo: ref });
    await expect(
      paymentAction(buildFinance(), p.id, { action: "refund" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
    // 空白字符串同样拒
    await expect(
      paymentAction(buildFinance(), p.id, { action: "refund", reason: "   " })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));

  it("有 reason → 原 payment 翻 REFUNDED, 不创建负数补偿", guard(async () => {
    const c = await mkContract("200.00", "REF-OK");
    const ref = `${TAG}-REF-OK`;
    const p = await mkPlannedPayment(c.id, null, 100, ref);
    await paymentAction(buildFinance(), p.id, { action: "confirm", bankRefNo: ref });
    const before = await prisma.payment.count({ where: { contractId: c.id, deletedAt: null } });
    const result = await paymentAction(buildFinance(), p.id, { action: "refund", reason: "客户撤销" });
    expect(result.status).toBe("REFUNDED");
    // 不应再创建新 payment 记录
    const after = await prisma.payment.count({ where: { contractId: c.id, deletedAt: null } });
    expect(after).toBe(before);
  }));

  it("refund 后 R-12 累计下降, 后续可继续 confirm (P1-2 回归)", guard(async () => {
    const c = await mkContract("100.00", "REF-AGAIN");
    const ref1 = `${TAG}-REF-AG1`;
    const p1 = await mkPlannedPayment(c.id, null, 100, ref1);
    await paymentAction(buildFinance(), p1.id, { action: "confirm", bankRefNo: ref1 });
    // 退款
    await paymentAction(buildFinance(), p1.id, { action: "refund", reason: "撤销" });
    // 再来一笔 100, 不应触发 PAYMENT_OVER_CONTRACT (因为 p1 已从 CONFIRMED 池里掉出来)
    const ref2 = `${TAG}-REF-AG2`;
    const p2 = await mkPlannedPayment(c.id, null, 100, ref2);
    await expect(
      paymentAction(buildFinance(), p2.id, { action: "confirm", bankRefNo: ref2 })
    ).resolves.toBeTruthy();
  }));
});
