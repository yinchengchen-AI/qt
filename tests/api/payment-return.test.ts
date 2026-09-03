// 回款状态机实务闭环 (v0.23): return 退回重录
//   return: CONFIRMED -> PLANNED (财务确认录入错误后退回业务重录, 区别于 refund)
//
// 覆盖:
//   1) FINANCE confirm 后 return -> PLANNED, 备注保留退回原因
//   2) return 未填原因 -> VALIDATION_FAILED 400
//   3) 从 PLANNED return -> ENTITY_IMMUTABLE 403
//   4) SALES return -> FORBIDDEN (return 是财务动作, 需 UPDATE + requireFinance)
//   5) 退回后可再次 confirm (confirm 支持覆盖流水号) 成功
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { paymentAction } from "@/server/services/payment";
import { nextBusinessNo } from "@/lib/sequence";

let dbReachable = false;
const TAG = `TEST-PAY-RT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdContractNos: string[] = [];
const createdPaymentIds: string[] = [];
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let financeUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "FINANCE" } | null = null;
let salesUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "SALES" } | null = null;
let testCustomerId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const load = async (code: "ADMIN" | "FINANCE" | "SALES") =>
    prisma.user.findFirst({
      where: { role: { code }, deletedAt: null, isSystem: false },
      select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
    });
  const [adminRow, financeRow, salesRow] = await Promise.all([load("ADMIN"), load("FINANCE"), load("SALES")]);
  if (!adminRow || !financeRow || !salesRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN" };
  financeUser = { id: financeRow.id, employeeNo: financeRow.employeeNo, name: financeRow.name, email: financeRow.email, roleCode: "FINANCE" };
  salesUser = { id: salesRow.id, employeeNo: salesRow.employeeNo, name: salesRow.name, email: salesRow.email, roleCode: "SALES" };
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
  if (!adminUser || !financeUser || !salesUser || !testCustomerId) return;
  await fn();
};

const build = (u: { id: string; employeeNo: string; name: string; email: string; roleCode: string }): SessionUser => ({
  id: u.id, employeeNo: u.employeeNo, name: u.name, email: u.email, roleCode: u.roleCode as SessionUser["roleCode"], permissions: []
});

async function mkSalesContract(suffix: string) {
  if (!salesUser || !testCustomerId) throw new Error("setup not ready");
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
      totalAmount: "1000.00",
      taxRate: "0.06",
      taxAmount: "0",
      amountExcludingTax: "0",
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: salesUser.id,
      signerId: salesUser.id,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: salesUser.id,
      updatedById: salesUser.id
    }
  });
}

async function mkPlannedPayment(contractId: string, _suffix: string) {
  if (!testCustomerId) throw new Error("setup not ready");
  const paymentNo = await nextBusinessNo("PAYMENT");
  const p = await prisma.payment.create({
    data: {
      paymentNo,
      customerId: testCustomerId,
      contractId,
      amount: "100.00",
      receivedAt: new Date(),
      method: "BANK_TRANSFER",
      status: "PLANNED",
      recorderUserId: salesUser!.id,
      createdById: salesUser!.id,
      updatedById: salesUser!.id
    }
  });
  createdPaymentIds.push(p.id);
  return p;
}

async function confirmPayment(id: string, refSuffix: string) {
  return paymentAction(build(financeUser!), id, {
    action: "confirm",
    bankRefNo: `${TAG}-REF-${refSuffix}`
  });
}

describe("paymentAction.return 退回重录 (CONFIRMED -> PLANNED)", () => {
  it("FINANCE confirm 后 return -> PLANNED 且备注带原因", guard(async () => {
    const c = await mkSalesContract("OK");
    const p = await mkPlannedPayment(c.id, "OK");
    const confirmed = await confirmPayment(p.id, "OK");
    expect(confirmed.status).toBe("CONFIRMED");
    const res = await paymentAction(build(financeUser!), p.id, { action: "return", reason: "金额录错,退回重录" });
    expect(res.status).toBe("PLANNED");
    expect(String(res.remark)).toContain("退回重录");
    const row = await prisma.payment.findUnique({ where: { id: p.id } });
    expect(row?.status).toBe("PLANNED");
  }));

  it("return 未填原因 -> VALIDATION_FAILED 400", guard(async () => {
    const c = await mkSalesContract("NOREASON");
    const p = await mkPlannedPayment(c.id, "NOREASON");
    await confirmPayment(p.id, "NOREASON");
    await expect(
      paymentAction(build(financeUser!), p.id, { action: "return", reason: "  " })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED, status: 400 });
  }));

  it("从 PLANNED return -> ENTITY_IMMUTABLE 403", guard(async () => {
    const c = await mkSalesContract("FROM-PLANNED");
    const p = await mkPlannedPayment(c.id, "FROM-PLANNED");
    await expect(
      paymentAction(build(financeUser!), p.id, { action: "return", reason: "测试" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.ENTITY_IMMUTABLE, status: 403 });
  }));

  it("SALES return -> FORBIDDEN (财务动作)", guard(async () => {
    const c = await mkSalesContract("SALES");
    const p = await mkPlannedPayment(c.id, "SALES");
    await confirmPayment(p.id, "SALES");
    await expect(
      paymentAction(build(salesUser!), p.id, { action: "return", reason: "越权" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN });
  }));

  it("退回后可再次 confirm (覆盖流水号) 成功", guard(async () => {
    const c = await mkSalesContract("RE-CONFIRM");
    const p = await mkPlannedPayment(c.id, "RE-CONFIRM");
    await confirmPayment(p.id, "RE-CONFIRM-A");
    await paymentAction(build(financeUser!), p.id, { action: "return", reason: "流水号录错" });
    const res = await confirmPayment(p.id, "RE-CONFIRM-B");
    expect(res.status).toBe("CONFIRMED");
  }));
});
