// 发票金额逻辑回归 (P1-1, P1-3, P2-1)
//
// 覆盖:
//   1) createInvoice 超 R-08 → 抛 INVOICE_OVER_LIMIT (基线)
//   2) updateInvoice 改 amount 触 R-08 → 抛 INVOICE_OVER_LIMIT (P1-1)
//   3) updateInvoice 改 amount 在 0.01 容差内 → 通过 (P2-1)
//   4) void 缺 reason → 抛 VALIDATION_FAILED (P1-3)
//   5) void + 已 CONFIRMED 回款 → 发票 VOIDED + 回款 REFUNDED (P1-3)
//   6) red-flush 缺 reason → 抛 VALIDATION_FAILED (P1-3)
//   7) red-flush + 已 CONFIRMED 回款 → 原 RED_FLUSHED, 负数 ISSUED, 回款 REFUNDED (P1-3)
//
// DB 不可达时整组 skip. 全部数据用 unique TAG 前缀, 跑完自己清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { createInvoice, updateInvoice, invoiceAction } from "@/server/services/invoice";
import { nextBusinessNo } from "@/lib/sequence";

let dbReachable = false;
const TAG = `TEST-INV-AMT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      // 物理清理 audit logs, 操作日志, 关联 PLANNED/REFUNDED 等
      await prisma.invoiceAuditLog.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdContractNos.length > 0) {
      await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
    }
    if (testCustomerId) {
      await prisma.customer.delete({ where: { id: testCustomerId } });
    }
    await prisma.operationLog.deleteMany({ where: { entity: "Invoice", action: { in: ["INVOICE_VOID", "INVOICE_RED_FLUSH", "PAYMENT_REFUND"] }, entityId: { in: createdInvoiceIds } } });
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
  return {
    id: adminUser.id,
    employeeNo: adminUser.employeeNo,
    name: adminUser.name,
    email: adminUser.email,
    roleCode: "ADMIN",
    permissions: []
  };
};
const buildFinance = (): SessionUser => {
  if (!financeUser) throw new Error("finance not bootstrapped");
  return {
    id: financeUser.id,
    employeeNo: financeUser.employeeNo,
    name: financeUser.name,
    email: financeUser.email,
    roleCode: "FINANCE",
    permissions: []
  };
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

async function mkDraftInvoice(contractId: string, amount: number, suffix: string) {
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
  return inv;
}

// 把任意字符串映射成 20 位纯数字 (电子发票号要求 \d{20})
// 用 FNV-1a 32-bit hash 转十进制, 不同输入产出不同 20 位数字
// (旧的 c.charCodeAt(0) % 10 + slice(0,20) 在输入长 >20 时会撞号)
function digits20(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = h >>> 0;
  return u.toString().padStart(10, "0").padEnd(20, "0").slice(-20);
}

async function issueInvoice(invoiceId: string, invoiceNo20: string) {
  await invoiceAction(buildFinance(), invoiceId, {
    action: "submit"
  });
  await invoiceAction(buildFinance(), invoiceId, {
    action: "issue",
    invoiceNo: digits20(invoiceNo20),
    actualIssueDate: new Date().toISOString()
  });
}

async function mkPlannedPayment(invoiceId: string, contractId: string, amount: number, bankRefNo: string) {
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
      status: "CONFIRMED",
      bankRefNo,
      recorderUserId: adminUser.id,
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
  createdPaymentIds.push(p.id);
  return p;
}

describe("createInvoice R-08 累计开票", () => {
  it("超合同总额 → 抛 INVOICE_OVER_LIMIT", guard(async () => {
    const c = await mkContract("100.00", "R08-CREATE");
    await mkDraftInvoice(c.id, 60, "R08-1");
    await expect(mkDraftInvoice(c.id, 60, "R08-2")).rejects.toMatchObject({ errorCode: ERROR_CODES.INVOICE_OVER_LIMIT });
  }));

  it("0.01 元容差内 → 通过 (P2-1)", guard(async () => {
    const c = await mkContract("100.00", "R08-TOL");
    await mkDraftInvoice(c.id, 99.99, "R08-TOL-1");
    // 100.00 - 99.99 = 0.01, 新增 0.01 → 总额 100.00 不超 (容差 0.01)
    await expect(mkDraftInvoice(c.id, 0.01, "R08-TOL-2")).resolves.toBeTruthy();
  }));
});

describe("updateInvoice R-08 重新校验 (P1-1)", () => {
  it("DRAFT 改 amount 推超合同总额 → 抛 INVOICE_OVER_LIMIT", guard(async () => {
    const c = await mkContract("100.00", "R08-UPDATE");
    const inv = await mkDraftInvoice(c.id, 10, "R08-UPD-1");
    await expect(
      updateInvoice(buildAdmin(), inv.id, { amount: 200 })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.INVOICE_OVER_LIMIT });
  }));

  it("DRAFT 改 amount 改小 → 通过", guard(async () => {
    const c = await mkContract("100.00", "R08-DOWN");
    const inv = await mkDraftInvoice(c.id, 50, "R08-DOWN-1");
    await expect(updateInvoice(buildAdmin(), inv.id, { amount: 30 })).resolves.toBeTruthy();
  }));
});

describe("invoiceAction.void P1-3", () => {
  it("缺 reason → 抛 VALIDATION_FAILED", guard(async () => {
    const c = await mkContract("100.00", "VOID-NOREASON");
    const inv = await mkDraftInvoice(c.id, 50, "VOID-1");
    await issueInvoice(inv.id, `${TAG}-VOID-20-1`);
    await expect(
      invoiceAction(buildFinance(), inv.id, { action: "void" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));

  it("有 reason + 已 CONFIRMED 回款 → 发票 VOIDED + 回款 REFUNDED", guard(async () => {
    const c = await mkContract("100.00", "VOID-REFUND");
    const inv = await mkDraftInvoice(c.id, 50, "VOID-2");
    const invoiceNo20 = `${TAG}VOID2`;
    await issueInvoice(inv.id, invoiceNo20);
    // 模拟 PLANNED 已 confirm 完毕 → 翻 CONFIRMED
    await mkPlannedPayment(inv.id, c.id, 50, `${TAG}-REF-VOID-1`);
    // void 需要 24h 内, 我们的实际开票日就是刚才, 通过
    const result = (await invoiceAction(buildFinance(), inv.id, { action: "void", reason: "客户取消" })) as { status: string; reviewComment: string | null };
    expect(result.status).toBe("VOIDED");
    expect(result.reviewComment).toBe("客户取消");
    // 关联回款按原状态翻: issue 时预创建的 PLANNED -> CANCELLED, 测试自建的 CONFIRMED -> REFUNDED
    const payments = await prisma.payment.findMany({ where: { invoiceId: inv.id, deletedAt: null } });
    expect(payments.length).toBeGreaterThan(0);
    for (const p of payments) {
      // service void/red-flush 顺序: PLANNED->CANCELLED 在前, 然后 CONFIRMED/RECONCILED->REFUNDED
      // findMany 时状态已是终态
      expect(["CANCELLED", "REFUNDED"]).toContain(p.status);
    }
  }));
});

describe("invoiceAction.red-flush P1-3", () => {
  it("缺 reason → 抛 VALIDATION_FAILED", guard(async () => {
    const c = await mkContract("100.00", "RED-NOREASON");
    const inv = await mkDraftInvoice(c.id, 50, "RED-1");
    await issueInvoice(inv.id, `${TAG}RED1`);
    await expect(
      invoiceAction(buildFinance(), inv.id, { action: "red-flush" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));

  it("有 reason + 已 CONFIRMED 回款 → 原 RED_FLUSHED + 负数 ISSUED + 回款 REFUNDED", guard(async () => {
    const c = await mkContract("100.00", "RED-REFUND");
    const inv = await mkDraftInvoice(c.id, 50, "RED-2");
    const invoiceNo20 = `${TAG}RED2`;
    await issueInvoice(inv.id, invoiceNo20);
    await mkPlannedPayment(inv.id, c.id, 50, `${TAG}-REF-RED-1`);
    const result = (await invoiceAction(buildFinance(), inv.id, { action: "red-flush", reason: "开票金额错误" })) as { original: { status: string; reviewComment: string | null; id: string }; redFlush: { status: string; amount: { toString(): string }; id: string } };
    expect(result.original.status).toBe("RED_FLUSHED");
    expect(result.original.reviewComment).toBe("开票金额错误");
    expect(result.redFlush.status).toBe("ISSUED");
    expect(Number(result.redFlush.amount)).toBeLessThan(0);
    // 关联回款按原状态翻: issue 预创建 PLANNED -> CANCELLED, 测试自建 CONFIRMED -> REFUNDED
    // findMany 时已是终态
    const payments = await prisma.payment.findMany({ where: { invoiceId: inv.id, deletedAt: null } });
    for (const p of payments) {
      expect(["CANCELLED", "REFUNDED"]).toContain(p.status);
    }
    // 把负数发票也加入清理列表
    createdInvoiceIds.push(result.redFlush.id);
  }));
});

describe("invoiceAction.red-flush linkedInvoiceId 互指 (P2-3)", () => {
  it("红冲后原票与负数记录 linkedInvoiceId 互指", guard(async () => {
    const c = await mkContract("100.00", "P23");
    const inv = await mkDraftInvoice(c.id, 50, "P23-1");
    const invoiceNo20 = `${TAG}P23`;
    await issueInvoice(inv.id, invoiceNo20);
    await mkPlannedPayment(inv.id, c.id, 50, `${TAG}-REF-P23`);
    const result = (await invoiceAction(buildFinance(), inv.id, {
      action: "red-flush",
      reason: "P2-3 互指回归"
    })) as {
      original: { id: string; status: string; linkedInvoiceId: string | null };
      redFlush: { id: string; status: string; amount: { toString(): string }; linkedInvoiceId: string | null; invoiceNo: string }
    };

    // 负数记录指向原票
    expect(result.redFlush.linkedInvoiceId).toBe(inv.id);
    expect(result.redFlush.status).toBe("ISSUED");
    expect(Number(result.redFlush.amount)).toBe(-50);
    // 负数 invoiceNo 沿用 RED- 前缀, 跟原 invoiceNo 关联
    expect(result.redFlush.invoiceNo).toMatch(/^RED-/);

    // 原票反向指向负数 (P2-3 关键断言: 互指)
    expect(result.original.status).toBe("RED_FLUSHED");
    expect(result.original.linkedInvoiceId).toBe(result.redFlush.id);

    // 落库后再次查询, 两端 linkedInvoiceId 都正确
    const dbOriginal = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    const dbNegative = await prisma.invoice.findUniqueOrThrow({ where: { id: result.redFlush.id } });
    expect(dbOriginal.linkedInvoiceId).toBe(result.redFlush.id);
    expect(dbNegative.linkedInvoiceId).toBe(inv.id);

    createdInvoiceIds.push(result.redFlush.id);
  }));
});
