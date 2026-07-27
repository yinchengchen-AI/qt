// 开票模块批量修复回归 (#3 红冲票守卫 / #4 TOCTOU 条件更新 / #5 并发锁 / #6 软删票号复用 422
//   / #8 PLANNED 取消审计 / #9 系统预建 PLANNED 金额同步 / #11 站内信通知)
//
// DB 不可达时整组 skip. 全部数据用 unique TAG 前缀, 跑完自己清理.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { createInvoice, updateInvoice, invoiceAction } from "@/server/services/invoice";

let dbReachable = false;
const TAG = `TEST-INV-FIX-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const testStart = new Date();
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
      await prisma.payment.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.operationLog.deleteMany({
        where: { entity: "Payment", action: "PAYMENT_CANCEL", entityId: { in: createdPaymentIds } }
      });
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdContractNos.length > 0) {
      await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
    }
    if (adminUser) {
      await prisma.message.deleteMany({
        where: {
          receiverUserId: adminUser.id,
          type: { in: ["INVOICE_ISSUED", "INVOICE_REJECTED"] },
          createdAt: { gte: testStart }
        }
      });
    }
    if (testCustomerId) {
      await prisma.customer.delete({ where: { id: testCustomerId } });
    }
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

// 与 invoice-amount.test.ts 相同的 FNV-1a → 20 位数字票号
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
  await invoiceAction(buildFinance(), invoiceId, { action: "submit" });
  await invoiceAction(buildFinance(), invoiceId, {
    action: "issue",
    invoiceNo: digits20(invoiceNo20),
    actualIssueDate: new Date().toISOString()
  });
  // issue 会自动创建一笔 PLANNED 回款, 收集 id 便于 afterAll 清理
  const planned = await prisma.payment.findFirst({
    where: { invoiceId, status: "PLANNED", deletedAt: null }
  });
  if (planned) createdPaymentIds.push(planned.id);
}

describe("#3 红冲票 (负数票) 不可再作废/再红冲", () => {
  it("对负数票 void → 403 FORBIDDEN; 再 red-flush → 403 FORBIDDEN", guard(async () => {
    const c = await mkContract("100.00", "REDFLUSH-GUARD");
    const inv = await mkDraftInvoice(c.id, 50, "RG-1");
    await issueInvoice(inv.id, `${TAG}RG1`);
    const result = (await invoiceAction(buildFinance(), inv.id, {
      action: "red-flush",
      reason: "开错票"
    })) as { redFlush: { id: string; status: string } };
    createdInvoiceIds.push(result.redFlush.id);
    expect(result.redFlush.status).toBe("ISSUED");

    // 负数票: void 与 red-flush 都应被守卫拦截
    await expect(
      invoiceAction(buildFinance(), result.redFlush.id, { action: "void", reason: "试试" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403 });
    await expect(
      invoiceAction(buildFinance(), result.redFlush.id, { action: "red-flush", reason: "试试" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403 });
  }));
});

describe("#4 updateInvoice 状态门控 TOCTOU", () => {
  it("事务外读到 DRAFT 但事务内已翻 PENDING_FINANCE → 条件更新撞 P2025 → 403 当前状态不可修改", guard(async () => {
    const c = await mkContract("100.00", "TOCTOU");
    const inv = await mkDraftInvoice(c.id, 50, "TOCTOU-1");
    // 真实状态翻成 PENDING_FINANCE (submit 由 admin 走, 与服务端无角色限制一致)
    await invoiceAction(buildAdmin(), inv.id, { action: "submit" });

    // 模拟竞态: 事务外预读返回的是"过期"的 DRAFT 快照 (绕过 :142 的友好预判),
    // 真正起作用的是事务内 where { id, status: "DRAFT" } 的条件更新
    const stale = { ...inv, status: "DRAFT" };
    const spy = vi.spyOn(prisma.invoice, "findFirst").mockResolvedValue(stale as never);
    try {
      await expect(
        updateInvoice(buildFinance(), inv.id, { titleName: `${TAG}-改` })
      ).rejects.toMatchObject({ errorCode: ERROR_CODES.ENTITY_IMMUTABLE, status: 403 });
    } finally {
      spy.mockRestore();
    }
    // 数据未被改动
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.titleName).toBe(`${TAG}-抬头`);
    expect(after.status).toBe("PENDING_FINANCE");
  }));
});

describe("#5 createInvoice 合同行锁 (FOR UPDATE) 并发序列化", () => {
  it("同一合同并发创建两张 60 (总额 100) → 恰一张成功, 另一张 INVOICE_OVER_LIMIT", guard(async () => {
    const c = await mkContract("100.00", "CONCUR");
    const results = await Promise.allSettled([
      mkDraftInvoice(c.id, 60, "CONCUR-A"),
      mkDraftInvoice(c.id, 60, "CONCUR-B")
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const overLimit = results.filter(
      (r) => r.status === "rejected" && (r.reason as { errorCode?: string }).errorCode === ERROR_CODES.INVOICE_OVER_LIMIT
    );
    expect(ok.length).toBe(1);
    expect(overLimit.length).toBe(1);
  }));
});

describe("#6 软删票号复用 → 422 (预校验查全量)", () => {
  it("软删的发票号再用于新建 → VALIDATION_FAILED 422 而不是 DB 撞 unique 变 500", guard(async () => {
    const c = await mkContract("100.00", "SOFTDEL-NO");
    const inv = await mkDraftInvoice(c.id, 10, "SD-1");
    // 软删该票 (deletedAt 置位), DB @unique 仍占号
    await prisma.invoice.update({ where: { id: inv.id }, data: { deletedAt: new Date() } });
    await expect(
      createInvoice(buildAdmin(), {
        contractId: c.id,
        invoiceNo: `${TAG}-INV-SD-1`,
        invoiceType: "VAT_SPECIAL",
        amount: 10,
        taxRate: 0.06,
        applyDate: new Date().toISOString(),
        titleType: "COMPANY",
        titleName: `${TAG}-抬头`,
        taxNo: "91330000123456789X",
        attachments: []
      })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED, status: 422 });
  }));
});

describe("#8 作废时 PLANNED 回款批量取消写审计", () => {
  it("void 后预建 PLANNED → CANCELLED, 且每笔有 PAYMENT_CANCEL 操作日志", guard(async () => {
    const c = await mkContract("100.00", "AUDIT-CANCEL");
    const inv = await mkDraftInvoice(c.id, 50, "AC-1");
    await issueInvoice(inv.id, `${TAG}AC1`);
    const planned = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: inv.id, status: "PLANNED", deletedAt: null }
    });
    await invoiceAction(buildFinance(), inv.id, { action: "void", reason: "客户取消" });
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: planned.id } });
    expect(after.status).toBe("CANCELLED");
    if (!financeUser) throw new Error("finance not bootstrapped");
    const log = await prisma.operationLog.findFirst({
      where: { entity: "Payment", entityId: planned.id, action: "PAYMENT_CANCEL", actorId: financeUser.id }
    });
    expect(log).toBeTruthy();
  }));
});

describe("#9 admin 改 ISSUED 票金额同步系统预建 PLANNED", () => {
  it("改金额后 -PLANNED 后缀的回款同步新金额; 手工 PLANNED 不动", guard(async () => {
    const c = await mkContract("100.00", "SYNC-PLANNED");
    const inv = await mkDraftInvoice(c.id, 50, "SP-1");
    await issueInvoice(inv.id, `${TAG}SP1`);
    const autoPlanned = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: inv.id, status: "PLANNED", deletedAt: null }
    });
    expect(autoPlanned.paymentNo.endsWith("-PLANNED")).toBe(true);
    // 手工登记的 PLANNED (paymentNo 不带 -PLANNED 后缀)
    if (!adminUser || !testCustomerId) throw new Error("setup not ready");
    const manual = await prisma.payment.create({
      data: {
        paymentNo: `${TAG}-MANUAL-P`,
        customerId: testCustomerId,
        contractId: c.id,
        invoiceId: inv.id,
        amount: "10",
        receivedAt: new Date(),
        method: "BANK_TRANSFER",
        status: "PLANNED",
        recorderUserId: adminUser.id,
        createdById: adminUser.id,
        updatedById: adminUser.id
      }
    });
    createdPaymentIds.push(manual.id);

    await updateInvoice(buildAdmin(), inv.id, { amount: 60 });

    const autoAfter = await prisma.payment.findUniqueOrThrow({ where: { id: autoPlanned.id } });
    const manualAfter = await prisma.payment.findUniqueOrThrow({ where: { id: manual.id } });
    expect(Number(autoAfter.amount)).toBe(60);
    expect(Number(manualAfter.amount)).toBe(10);
  }));
});

describe("#11 开票/驳回站内信通知申请人", () => {
  it("issue → 申请人收到 INVOICE_ISSUED; reject → 申请人收到 INVOICE_REJECTED (含原因)", guard(async () => {
    if (!adminUser) throw new Error("admin not bootstrapped");
    const c = await mkContract("100.00", "NOTIFY");
    const inv = await mkDraftInvoice(c.id, 50, "NT-1");
    await issueInvoice(inv.id, `${TAG}NT1`);
    const issueMsg = await prisma.message.findFirst({
      where: { receiverUserId: adminUser.id, type: "INVOICE_ISSUED" },
      orderBy: { createdAt: "desc" }
    });
    expect(issueMsg).toBeTruthy();

    const inv2 = await mkDraftInvoice(c.id, 40, "NT-2");
    await invoiceAction(buildFinance(), inv2.id, { action: "submit" });
    await invoiceAction(buildFinance(), inv2.id, { action: "reject", reason: "抬头有误" });
    const rejectMsg = await prisma.message.findFirst({
      where: { receiverUserId: adminUser.id, type: "INVOICE_REJECTED" },
      orderBy: { createdAt: "desc" }
    });
    expect(rejectMsg).toBeTruthy();
    expect(rejectMsg?.content).toContain("抬头有误");
  }));
});
