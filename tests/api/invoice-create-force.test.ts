// 完结合同补开发票 (force 旁路) 回归
//
// 覆盖:
//   1) createInvoice 默认仍拒绝 CLOSED 合同 (无 force)
//   2) ADMIN + force + CLOSED → 成功, remark 含 [FORCE_BACKFILL] 审计标记
//   3) FINANCE + force + CLOSED → 成功 (与 createPayment force 旁路同口径)
//   4) 非 ADMIN/FINANCE (SALES) + force → 403
//   5) force 模式必须填 forceReason → 400
//   6) force + DRAFT 合同 → 拒绝 (DRAFT 不在旁路白名单)
//   7) force 不绕过 R-08 累计开票上限 (INVOICE_OVER_LIMIT)

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { createInvoice } from "@/server/services/invoice";

let dbReachable = false;
const TAG = `TEST-INV-FORCE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdInvoiceIds: string[] = [];
const createdContractNos: string[] = [];
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
    if (createdInvoiceIds.length > 0) {
      await prisma.invoiceAuditLog.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.payment.deleteMany({ where: { invoiceId: { in: createdInvoiceIds } } });
      await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    }
    if (createdContractNos.length > 0) {
      await prisma.contract.deleteMany({ where: { contractNo: { in: createdContractNos } } });
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

async function mkContract(totalAmount: string, suffix: string, status: "DRAFT" | "ACTIVE" | "CLOSED" = "ACTIVE") {
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
      status,
      ownerUserId: adminUser.id,
      signerId: adminUser.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
}

function mkInvoiceInput(contractId: string, amount: number, suffix: string) {
  return {
    contractId,
    invoiceNo: `${TAG}-INV-${suffix}`,
    invoiceType: "VAT_SPECIAL" as const,
    amount,
    taxRate: 0.06,
    applyDate: new Date().toISOString(),
    titleType: "COMPANY" as const,
    titleName: `${TAG}-抬头`,
    taxNo: "91330000123456789X",
    attachments: []
  };
}

describe("createInvoice 合同状态校验", () => {
  it("CLOSED 合同无 force → 拒绝 (CONTRACT_STATUS_INVALID)", guard(async () => {
    const c = await mkContract("1000.00", "CLOSED-NOFORCE", "CLOSED");
    await expect(
      createInvoice(buildAdmin(), mkInvoiceInput(c.id, 100, "NOFORCE"))
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.CONTRACT_STATUS_INVALID });
  }));
});

// =====================================================
// 完结补录旁路 (与 createPayment 的 admin/财务 force 同口径):
//   - 触发场景: 合同已完结(CLOSED)后仍需补开发票/尾票
//   - 安全约束: 仅 ADMIN/FINANCE 可用; force 模式下必须填 forceReason
//   - 业务校验不变: R-08 累计开票仍不能超合同总额
// =====================================================
describe("createInvoice 完结补录 force 旁路", () => {
  it("ADMIN + force + CLOSED 合同 → 成功, remark 含 [FORCE_BACKFILL] 标记", guard(async () => {
    const c = await mkContract("1000.00", "FORCE-OK", "CLOSED");
    const inv = await createInvoice(
      buildAdmin(),
      { ...mkInvoiceInput(c.id, 200, "FORCE-OK"), remark: "尾票补开" },
      { force: true, forceReason: "完结后客户要求补开尾票" },
    );
    if (!inv) throw new Error("createInvoice returned null");
    createdInvoiceIds.push(inv.id);
    expect(inv.contractId).toBe(c.id);
    expect(inv.status).toBe("DRAFT");
    expect(inv.remark).toContain("[FORCE_BACKFILL:完结后客户要求补开尾票]");
    expect(inv.remark).toContain("尾票补开");
  }));

  it("FINANCE + force + CLOSED 合同 → 成功", guard(async () => {
    const c = await mkContract("1000.00", "FORCE-FIN", "CLOSED");
    const inv = await createInvoice(
      buildFinance(),
      mkInvoiceInput(c.id, 100, "FORCE-FIN"),
      { force: true, forceReason: "财务做账补开" },
    );
    if (!inv) throw new Error("createInvoice returned null");
    createdInvoiceIds.push(inv.id);
    expect(inv.contractId).toBe(c.id);
    expect(inv.remark).toContain("[FORCE_BACKFILL:财务做账补开]");
  }));

  it("SALES + force → 403 (非 ADMIN/FINANCE 拒绝 force)", guard(async () => {
    const c = await mkContract("1000.00", "FORCE-SALES", "CLOSED");
    // 借用 finance 账号的身份但伪装 SALES roleCode: force 角色闸门在事务前触发,
    // 先于 assertRecordWritable, 不会打到所有权校验
    const fakeSales: SessionUser = { ...buildFinance(), roleCode: "SALES" };
    await expect(
      createInvoice(
        fakeSales,
        mkInvoiceInput(c.id, 100, "FORCE-SALES"),
        { force: true, forceReason: "test" },
      ),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN });
  }));

  it("ADMIN + force + 不填 forceReason → 400", guard(async () => {
    const c = await mkContract("1000.00", "FORCE-NONOTE", "CLOSED");
    await expect(
      createInvoice(
        buildAdmin(),
        mkInvoiceInput(c.id, 100, "FORCE-NONOTE"),
        { force: true },
      ),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));

  it("ADMIN + force + DRAFT 合同 → 拒绝 (DRAFT 不在 force 旁路白名单)", guard(async () => {
    const c = await mkContract("1000.00", "FORCE-DRAFT", "DRAFT");
    await expect(
      createInvoice(
        buildAdmin(),
        mkInvoiceInput(c.id, 100, "FORCE-DRAFT"),
        { force: true, forceReason: "test" },
      ),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.CONTRACT_STATUS_INVALID });
  }));

  it("ADMIN + force + 超合同总额 → 仍拒 (force 不绕过 R-08 上限)", guard(async () => {
    const c = await mkContract("100.00", "FORCE-OVER", "CLOSED");
    await expect(
      createInvoice(
        buildAdmin(),
        mkInvoiceInput(c.id, 200, "FORCE-OVER"),
        { force: true, forceReason: "test" },
      ),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.INVOICE_OVER_LIMIT });
  }));
});
