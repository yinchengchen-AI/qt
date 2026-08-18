// 回款浏览权限回归 (role-browse-permissions todo 6)
//
// 新口径: SALES/EXPERT 对 Payment 全量可读 (list/get 不再按 owner 过滤),
// 写路径改为显式 owner 断言:
//   1) SALES list/get 他人 (ADMIN) 合同下的回款 → 200 可见
//   2) EXPERT get 他人回款 → 200 可见
//   3) SALES 在他人合同下登记回款 → 403 (assertRecordWritable "无权操作他人回款")
//   4) SALES 在自己合同下登记回款 → 200
//   5) EXPERT 登记回款 → 403 (矩阵无 PAYMENT.CREATE)
//   6) SALES 在不存在合同登记 → 404 (不是 500)
//   7) cancel 守门保持现状: 显式 recorder precondition (payment.ts:380),
//      SALES 取消自己登记 → 200; 取消他人登记 (合同仍是自己的, 证明不是行过滤在拦) → 403
//   8) confirm / reconcile / refund by SALES → 403 (requireFinance/UPDATE 门控不动)
//
// DB 不可达时整组 skip. 全部数据用 unique TAG 前缀, 跑完自己清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { listPayments, getPayment, createPayment, paymentAction } from "@/server/services/payment";
import { nextBusinessNo } from "@/lib/sequence";

let dbReachable = false;
const TAG = `TEST-PAY-BROWSE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createdContractNos: string[] = [];
const createdPaymentIds: string[] = [];
type RoleCode = "ADMIN" | "FINANCE" | "SALES" | "EXPERT";
let adminUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "ADMIN" } | null = null;
let salesUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "SALES" } | null = null;
let expertUser: { id: string; employeeNo: string; name: string; email: string; roleCode: "EXPERT" } | null = null;
let testCustomerId: string | null = null;

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  // 按 employeeNo 钉到种子账号: findFirst 仅按 role 无序匹配, 会撞到其它测试文件并发
  // 创建的同角色临时用户 (如 employee-profile-visibility 的 role.findFirst 任意角色),
  // 对方 afterAll 删除后本文件用其 id 建合同触发 Contract_signerId_fkey 23503
  const load = async (code: RoleCode, employeeNo: string) =>
    prisma.user.findFirst({
      where: { role: { code }, employeeNo, deletedAt: null },
      select: { id: true, employeeNo: true, name: true, email: true, role: { select: { code: true } } }
    });
  const [adminRow, salesRow, expertRow] = await Promise.all([load("ADMIN", "admin"), load("SALES", "sales"), load("EXPERT", "expert")]);
  if (!adminRow || !salesRow || !expertRow) return;
  adminUser = { id: adminRow.id, employeeNo: adminRow.employeeNo, name: adminRow.name, email: adminRow.email, roleCode: "ADMIN" };
  salesUser = { id: salesRow.id, employeeNo: salesRow.employeeNo, name: salesRow.name, email: salesRow.email, roleCode: "SALES" };
  expertUser = { id: expertRow.id, employeeNo: expertRow.employeeNo, name: expertRow.name, email: expertRow.email, roleCode: "EXPERT" };
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
  if (!adminUser || !salesUser || !expertUser || !testCustomerId) return;
  await fn();
};

const build = (u: { id: string; employeeNo: string; name: string; email: string; roleCode: RoleCode }): SessionUser => ({
  id: u.id, employeeNo: u.employeeNo, name: u.name, email: u.email, roleCode: u.roleCode, permissions: []
});

async function mkContract(suffix: string, ownerId: string) {
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
      totalAmount: "1000.00",
      taxRate: "0.06",
      taxAmount: "0",
      amountExcludingTax: "0",
      paymentMethod: "LUMP_SUM",
      status: "ACTIVE",
      ownerUserId: ownerId,
      signerId: ownerId,
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id
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

describe("payment 读放开: SALES/EXPERT 可见他人回款", () => {
  it("SALES listPayments 按他人合同过滤 → 命中他人回款", guard(async () => {
    const c = await mkContract("READ-LIST", adminUser!.id);
    const p = await mkPlannedPayment(c.id, adminUser!.id, 100, "READ-LIST");
    const { list, total } = await listPayments(build(salesUser!), { page: 1, pageSize: 10, contractId: c.id });
    expect(total).toBeGreaterThanOrEqual(1);
    expect(list.some((r) => r.id === p.id)).toBe(true);
  }));

  it("SALES getPayment 他人回款 → 200 返回", guard(async () => {
    const c = await mkContract("READ-GET", adminUser!.id);
    const p = await mkPlannedPayment(c.id, adminUser!.id, 100, "READ-GET");
    const got = await getPayment(build(salesUser!), p.id);
    expect(got.id).toBe(p.id);
  }));

  it("EXPERT getPayment 他人回款 → 200 返回", guard(async () => {
    const c = await mkContract("READ-GET-EXP", adminUser!.id);
    const p = await mkPlannedPayment(c.id, adminUser!.id, 100, "READ-GET-EXP");
    const got = await getPayment(build(expertUser!), p.id);
    expect(got.id).toBe(p.id);
  }));
});

describe("createPayment 写守门: 按合同 owner 断言", () => {
  it("SALES 在他人 (ADMIN) 合同下登记 → 403 无权操作他人回款", guard(async () => {
    const c = await mkContract("WRITE-OTHER", adminUser!.id);
    const err = await createPayment(build(salesUser!), {
      contractId: c.id, amount: 100, receivedAt: new Date().toISOString(), method: "BANK_TRANSFER"
    }).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403 });
    expect(String((err as Error).message)).toContain("无权操作他人回款");
  }));

  it("SALES 在自己合同下登记 → 200 成功", guard(async () => {
    const c = await mkContract("WRITE-OWN", salesUser!.id);
    const p = await createPayment(build(salesUser!), {
      contractId: c.id, amount: 100, receivedAt: new Date().toISOString(), method: "BANK_TRANSFER"
    });
    expect(p.status).toBe("PLANNED");
    expect(p.recorderUserId).toBe(salesUser!.id);
    createdPaymentIds.push(p.id);
  }));

  it("EXPERT 登记回款 → 403 (矩阵无 PAYMENT.CREATE)", guard(async () => {
    const c = await mkContract("WRITE-EXP", expertUser!.id);
    await expect(
      createPayment(build(expertUser!), {
        contractId: c.id, amount: 100, receivedAt: new Date().toISOString(), method: "BANK_TRANSFER"
      })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN });
  }));

  it("SALES 在不存在的合同上登记 → 404 (非 500)", guard(async () => {
    const err = await createPayment(build(salesUser!), {
      contractId: `${TAG}-NO-SUCH-CONTRACT`, amount: 100, receivedAt: new Date().toISOString(), method: "BANK_TRANSFER"
    }).then(() => null, (e: unknown) => e);
    expect(err).toMatchObject({ errorCode: ERROR_CODES.NOT_FOUND, status: 404 });
    expect(String((err as Error).message)).toContain("合同不存在");
  }));
});

describe("paymentAction.cancel 守门保持现状 (显式 recorder precondition, 非行过滤)", () => {
  it("SALES 取消自己合同上自己登记的 PLANNED → 200", guard(async () => {
    const c = await mkContract("CXL-OWN", salesUser!.id);
    const p = await mkPlannedPayment(c.id, salesUser!.id, 100, "CXL-OWN");
    const result = await paymentAction(build(salesUser!), p.id, { action: "cancel" });
    expect(result.status).toBe("CANCELLED");
  }));

  it("SALES 取消自己合同上他人 (ADMIN) 登记的 PLANNED → 403 (precondition 拦, 非行过滤)", guard(async () => {
    // 合同 owner 是 SALES — 若有行过滤也放行; 403 只能来自 :380 的 recorder precondition
    const c = await mkContract("CXL-OTHER", salesUser!.id);
    const p = await mkPlannedPayment(c.id, adminUser!.id, 100, "CXL-OTHER");
    await expect(
      paymentAction(build(salesUser!), p.id, { action: "cancel" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403 });
  }));
});

describe("confirm/reconcile/refund 的 FINANCE 门控保持", () => {
  it("SALES confirm → 403", guard(async () => {
    const c = await mkContract("GATE-CONFIRM", salesUser!.id);
    const p = await mkPlannedPayment(c.id, salesUser!.id, 100, "GATE-CONFIRM");
    await expect(
      paymentAction(build(salesUser!), p.id, { action: "confirm", bankRefNo: `${TAG}-REF-GATE-CONFIRM` })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403 });
  }));

  it("SALES reconcile → 403", guard(async () => {
    const c = await mkContract("GATE-RECON", salesUser!.id);
    const p = await mkPlannedPayment(c.id, salesUser!.id, 100, "GATE-RECON");
    await expect(
      paymentAction(build(salesUser!), p.id, { action: "reconcile" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403 });
  }));

  it("SALES refund → 403", guard(async () => {
    const c = await mkContract("GATE-REFUND", salesUser!.id);
    const p = await mkPlannedPayment(c.id, salesUser!.id, 100, "GATE-REFUND");
    await expect(
      paymentAction(build(salesUser!), p.id, { action: "refund", reason: "测试退款" })
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN, status: 403 });
  }));
});
