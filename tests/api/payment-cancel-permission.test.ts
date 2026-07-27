// 回款 cancel 权限分流回归 (P0: SALES/EXPERT 无法取消自己登记的 PLANNED)
//
// 覆盖:
//   1) SALES 取消自己登记的 PLANNED → 成功 (入口要求 CREATE, 非 UPDATE)
//   2) SALES 取消他人登记的 PLANNED → 403 (precondition 限定创建人本人)
//   3) SALES confirm → 403 (confirm 仍需 UPDATE 权限)
//   4) FINANCE 取消 SALES 登记的 PLANNED → 成功
//
// DB 不可达时整组 skip. 全部数据用 unique TAG 前缀, 跑完自己清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { paymentAction } from "@/server/services/payment";
import { nextBusinessNo } from "@/lib/sequence";

let dbReachable = false;
const TAG = `TEST-PAY-CXL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      where: { role: { code }, deletedAt: null },
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
    await prisma.operationLog.deleteMany({ where: { entity: "Payment", action: "PAYMENT_CANCEL" } });
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

const build = (u: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" | "FINANCE" | "SALES" }): SessionUser => ({
  id: u.id, employeeNo: u.employeeNo, name: u.name, email: u.email, roleCode: u.roleCode, permissions: []
});

// 合同挂在 SALES 名下, 保证 SALES 过 ownerViaContract 行级过滤能 load 到回款
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

async function mkPlannedPayment(contractId: string, recorderId: string, amount: number, suffix: string) {
  if (!testCustomerId) throw new Error("setup not ready");
  const paymentNo = await nextBusinessNo("PAYMENT");
  const p = await prisma.payment.create({
    data: {
      paymentNo,
      customerId: testCustomerId,
      contractId,
      amount: amount.toString(),
      receivedAt: new Date(),
      method: "BANK_TRANSFER",
      status: "PLANNED",
      bankRefNo: `${TAG}-REF-${suffix}`,
      recorderUserId: recorderId,
      createdById: recorderId,
      updatedById: recorderId
    }
  });
  createdPaymentIds.push(p.id);
  return p;
}

describe("paymentAction.cancel 权限分流", () => {
  it("SALES 取消自己登记的 PLANNED → 成功", guard(async () => {
    const c = await mkSalesContract("OWN");
    const p = await mkPlannedPayment(c.id, salesUser!.id, 100, "OWN");
    const result = await paymentAction(build(salesUser!), p.id, { action: "cancel" });
    expect(result.status).toBe("CANCELLED");
  }));

  it("SALES 取消他人登记的 PLANNED → 403", guard(async () => {
    const c = await mkSalesContract("OTHER");
    const p = await mkPlannedPayment(c.id, adminUser!.id, 100, "OTHER");
    await expect(
      paymentAction(build(salesUser!), p.id, { action: "cancel" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN });
  }));

  it("SALES confirm → 403 (confirm 仍需 UPDATE 权限)", guard(async () => {
    const c = await mkSalesContract("CONFIRM");
    const p = await mkPlannedPayment(c.id, salesUser!.id, 100, "CONFIRM");
    await expect(
      paymentAction(build(salesUser!), p.id, { action: "confirm", bankRefNo: `${TAG}-REF-CONFIRM` })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN });
  }));

  it("FINANCE 取消 SALES 登记的 PLANNED → 成功", guard(async () => {
    const c = await mkSalesContract("FIN");
    const p = await mkPlannedPayment(c.id, salesUser!.id, 100, "FIN");
    const result = await paymentAction(build(financeUser!), p.id, { action: "cancel" });
    expect(result.status).toBe("CANCELLED");
  }));
});
