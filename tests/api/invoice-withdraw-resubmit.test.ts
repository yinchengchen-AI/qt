// 发票状态机实务闭环 (v0.23):
//   withdraw 撤回: PENDING_FINANCE -> DRAFT (财务处理前申请人/管理员取回修改)
//   resubmit 重提: REJECTED -> PENDING_FINANCE (被驳回后修改正确重新提交, 复检 R-08 含本票)
//   REJECTED 可编辑: 非 admin 也允许改 REJECTED (支撑重提闭环)
//
// 覆盖:
//   1) SALES 撤回自己提交的 PENDING_FINANCE -> DRAFT
//   2) SALES 撤回他人发票 -> 403
//   3) 从 ISSUED 撤回 -> ENTITY_IMMUTABLE 403
//   4) SALES 重提被驳回的发票 -> PENDING_FINANCE
//   5) 重提时合同额度已被其它票占满 -> INVOICE_OVER_LIMIT (includeSelf 复检)
//   6) SALES 编辑 REJECTED 发票成功 (以前被拒)
//   7) 无权限角色 (OPS) 撤回 -> FORBIDDEN
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { createInvoice, updateInvoice, invoiceAction } from "@/server/services/invoice";

let dbReachable = false;
const TAG = `TEST-INV-SM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdInvoiceIds: string[] = [];
const createdContractNos: string[] = [];
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let salesUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "SALES" } | null = null;
let financeUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "FINANCE" } | null = null;
let opsUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "OPS" } | null = null;
let testCustomerId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const load = async (code: "ADMIN" | "SALES" | "FINANCE" | "OPS") =>
    prisma.user.findFirst({
      where: { role: { code }, deletedAt: null, isSystem: false },
      select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
    });
  const [adminRow, salesRow, financeRow, opsRow] = await Promise.all([load("ADMIN"), load("SALES"), load("FINANCE"), load("OPS")]);
  if (!adminRow || !salesRow || !financeRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN" };
  salesUser = { id: salesRow.id, employeeNo: salesRow.employeeNo, name: salesRow.name, email: salesRow.email, roleCode: "SALES" };
  financeUser = { id: financeRow.id, employeeNo: financeRow.employeeNo, name: financeRow.name, email: financeRow.email, roleCode: "FINANCE" };
  if (opsRow) opsUser = { id: opsRow.id, employeeNo: opsRow.employeeNo, name: opsRow.name, email: opsRow.email, roleCode: "OPS" };
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
  if (!adminUser || !salesUser || !financeUser || !testCustomerId) return;
  await fn();
};

const build = (u: { id: string; employeeNo: string; name: string; email: string; roleCode: string }): SessionUser => ({
  id: u.id, employeeNo: u.employeeNo, name: u.name, email: u.email, roleCode: u.roleCode as SessionUser["roleCode"], permissions: []
});

async function mkContract(totalAmount: string, suffix: string, ownerUserId?: string) {
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
      ownerUserId: ownerUserId ?? adminUser!.id,
      signerId: ownerUserId ?? adminUser!.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id
    }
  });
}

async function mkDraft(contractId: string, suffix: string, amount = 100, invoiceNo?: string) {
  const inv = await createInvoice(build(adminUser!), {
    contractId,
    invoiceNo: invoiceNo ?? `${TAG}-${suffix}`,
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

describe("发票 withdraw 撤回 (PENDING_FINANCE -> DRAFT)", () => {
  it("SALES 撤回自己提交的 PENDING_FINANCE -> DRAFT", guard(async () => {
    const c = await mkContract("10000.00", "WD-OK", salesUser!.id);
    const inv = await mkDraft(c.id, "WD-OK", 100);
    await invoiceAction(build(salesUser!), inv.id, { action: "submit" });
    const after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    expect(after?.status).toBe("PENDING_FINANCE");
    const res = await invoiceAction(build(salesUser!), inv.id, { action: "withdraw" });
    expect(res?.status).toBe("DRAFT");
  }));

  it("SALES 撤回他人合同下的发票 -> FORBIDDEN 403", guard(async () => {
    const c = await mkContract("10000.00", "WD-OTHER", adminUser!.id);
    const inv = await mkDraft(c.id, "WD-OTHER", 100);
    await invoiceAction(build(adminUser!), inv.id, { action: "submit" });
    await expect(
      invoiceAction(build(salesUser!), inv.id, { action: "withdraw" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403 });
  }));

  it("从 ISSUED 撤回 -> ENTITY_IMMUTABLE 403", guard(async () => {
    const c = await mkContract("10000.00", "WD-LOCKED", salesUser!.id);
    const inv = await mkDraft(c.id, "WD-LOCKED", 100);
    await invoiceAction(build(salesUser!), inv.id, { action: "submit" });
    await invoiceAction(build(financeUser!), inv.id, {
      action: "issue",
      invoiceNo: `${TAG}-NO-WD-LOCKED`,
      actualIssueDate: new Date().toISOString()
    });
    await expect(
      invoiceAction(build(financeUser!), inv.id, { action: "withdraw" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.ENTITY_IMMUTABLE, status: 403 });
  }));

  it("OPS 撤回 -> FORBIDDEN (矩阵层无 INVOICE UPDATE)", guard(async () => {
    if (!opsUser) return;
    const c = await mkContract("10000.00", "WD-OPS");
    const inv = await mkDraft(c.id, "WD-OPS", 100);
    await invoiceAction(build(adminUser!), inv.id, { action: "submit" });
    await expect(
      invoiceAction(build(opsUser), inv.id, { action: "withdraw" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN });
  }));
});

describe("发票 resubmit 重提 (REJECTED -> PENDING_FINANCE)", () => {
  it("SALES 重提被驳回的发票 -> PENDING_FINANCE", guard(async () => {
    const c = await mkContract("10000.00", "RS-OK", salesUser!.id);
    const inv = await mkDraft(c.id, "RS-OK", 100);
    await invoiceAction(build(salesUser!), inv.id, { action: "submit" });
    await invoiceAction(build(financeUser!), inv.id, { action: "reject", reason: "抬头有误" });
    let after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    expect(after?.status).toBe("REJECTED");
    // 驳回后可编辑修改 (标题修正) 再重提
    const edited = await updateInvoice(build(salesUser!), inv.id, { titleName: `${TAG}-改后抬头` });
    expect(edited.titleName).toBe(`${TAG}-改后抬头`);
    const res = await invoiceAction(build(salesUser!), inv.id, { action: "resubmit" });
    expect(res?.status).toBe("PENDING_FINANCE");
    after = await prisma.invoice.findUnique({ where: { id: inv.id } });
    expect(after?.status).toBe("PENDING_FINANCE");
  }));

  it("重提复检 R-08: 额度被其它已开票占满 -> INVOICE_OVER_LIMIT", guard(async () => {
    // 合同总额 100
    //  票A=100 提交后被驳回 (不计额度, 腾出空间)
    //  票B=100 提交并由财务开票 (占满额度)
    //  重提票A → 100(票B) + 100(票A) > 100 → 422 (验证 includeSelf 复检)
    const c = await mkContract("100.00", "RS-LIMIT", salesUser!.id);
    const a = await mkDraft(c.id, "RS-LIMIT-A", 100);
    await invoiceAction(build(salesUser!), a.id, { action: "submit" });
    await invoiceAction(build(financeUser!), a.id, { action: "reject", reason: "驳回A" });
    const b = await mkDraft(c.id, "RS-LIMIT-B", 100);
    await invoiceAction(build(salesUser!), b.id, { action: "submit" });
    await invoiceAction(build(financeUser!), b.id, {
      action: "issue",
      invoiceNo: `${TAG}-NO-RS-LIMIT`,
      actualIssueDate: new Date().toISOString()
    });
    await expect(
      invoiceAction(build(salesUser!), a.id, { action: "resubmit" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.INVOICE_OVER_LIMIT, status: 422 });
  }));

  it("重提不含本票的额度校验 (includeSelf=false 语义): 仅他票占额未超 -> 通过", guard(async () => {
    // 合同总额 100; 票A=60 被驳回, 重提时他票占 0, 60 ≤ 100 通过
    const c = await mkContract("100.00", "RS-FIT", salesUser!.id);
    const a = await mkDraft(c.id, "RS-FIT-A", 60);
    await invoiceAction(build(salesUser!), a.id, { action: "submit" });
    await invoiceAction(build(financeUser!), a.id, { action: "reject", reason: "驳回" });
    const res = await invoiceAction(build(salesUser!), a.id, { action: "resubmit" });
    expect(res?.status).toBe("PENDING_FINANCE");
  }));

  it("从 DRAFT 重提 -> ENTITY_IMMUTABLE 403", guard(async () => {
    const c = await mkContract("10000.00", "RS-LOCKED", salesUser!.id);
    const inv = await mkDraft(c.id, "RS-LOCKED", 100);
    await expect(
      invoiceAction(build(salesUser!), inv.id, { action: "resubmit" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.ENTITY_IMMUTABLE, status: 403 });
  }));
});

describe("发票 REJECTED 可编辑 (非 admin)", () => {
  it("SALES 改 REJECTED 发票金额写入成功", guard(async () => {
    const c = await mkContract("10000.00", "EDIT-REJ", salesUser!.id);
    const inv = await mkDraft(c.id, "EDIT-REJ", 100);
    await invoiceAction(build(salesUser!), inv.id, { action: "submit" });
    await invoiceAction(build(financeUser!), inv.id, { action: "reject", reason: "金额错误" });
    const updated = await updateInvoice(build(salesUser!), inv.id, { amount: 80 });
    expect(updated.amount.toString()).toBe("80");
    expect(updated.status).toBe("REJECTED");
  }));
});
