// 合同 reopen 接口 (admin 重新打开已完结合同) 回归测试
//
// 设计:
//   reopenContract: CLOSED → ACTIVE (admin 专属)
//   - 走完整事务 + ContractReviewLog (action=MANUAL_REOPEN) + audit log
//   - reviewComment 改为 "reopened:<reason>" 作为审计标记
//   - 仅 ADMIN 可调用
//   - 目标合同必须当前为 CLOSED
//
// 覆盖:
//   1) ADMIN + CLOSED 合同 → 成功, status=ACTIVE, 写 ContractReviewLog
//   2) 非 ADMIN (FINANCE/SALES) → 403 FORBIDDEN
//   3) 不存在的合同 → 404
//   4) ACTIVE / DRAFT 合同 → 403 ENTITY_IMMUTABLE
//   5) reason=other 但未填 reasonNote → 400 VALIDATION_FAILED
//   6) soft-deleted 合同 → 404
//
// DB 不可达时整组 skip. 全部数据用 unique TAG 前缀, 跑完自己清理.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { ERROR_CODES } from "@/types/errors";
import type { SessionUser } from "@/lib/session";
import { reopenContract } from "@/server/services/contract";

let dbReachable = false;
const TAG = `TEST-REOPEN-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let adminUser: { id: string; employeeNo: string; name: string; email: string } | null = null;
let financeUser: { id: string; employeeNo: string; name: string; email: string } | null = null;
let salesUser: { id: string; employeeNo: string; name: string; email: string } | null = null;
let testCustomerId: string | null = null;
const createdContractIds: string[] = [];

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  const [adminRow, financeRow, salesRow] = await Promise.all([
    prisma.user.findFirst({
      where: { role: { code: "ADMIN" }, deletedAt: null },
      select: { id: true, employeeNo: true, name: true, email: true },
    }),
    prisma.user.findFirst({
      where: { role: { code: "FINANCE" }, deletedAt: null },
      select: { id: true, employeeNo: true, name: true, email: true },
    }),
    prisma.user.findFirst({
      where: { role: { code: "SALES" }, deletedAt: null },
      select: { id: true, employeeNo: true, name: true, email: true },
    }),
  ]);
  if (!adminRow) return;
  adminUser = adminRow;
  financeUser = financeRow;
  salesUser = salesRow;
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
      ownerUserId: adminUser.id,
    },
  });
  testCustomerId = cust.id;
});

afterAll(async () => {
  if (!dbReachable) return;
  try {
    if (createdContractIds.length > 0) {
      await prisma.contractReviewLog.deleteMany({
        where: { contractId: { in: createdContractIds } },
      });
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

const guard = (fn: () => Promise<void>) => async () => {
  if (!dbReachable || !adminUser || !testCustomerId) return;
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
    permissions: [],
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
    permissions: [],
  };
};
const buildSales = (): SessionUser => {
  if (!salesUser) throw new Error("sales not bootstrapped");
  return {
    id: salesUser.id,
    employeeNo: salesUser.employeeNo,
    name: salesUser.name,
    email: salesUser.email,
    roleCode: "SALES",
    permissions: [],
  };
};

async function mkContract(opts: {
  status: "DRAFT" | "ACTIVE" | "CLOSED";
  suffix: string;
  deletedAt?: Date | null;
}) {
  if (!adminUser || !testCustomerId) throw new Error("setup not ready");
  const no = `${TAG}-${opts.suffix}`;
  const c = await prisma.contract.create({
    data: {
      contractNo: no,
      customerId: testCustomerId,
      customerName: `${TAG}-客户`,
      title: `${TAG}-title-${opts.suffix}`,
      serviceType: "OTHER",
      signDate: new Date("2026-01-01T00:00:00Z"),
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-06-30T16:00:00Z"),
      totalAmount: "10000.00",
      taxRate: "0.06",
      taxAmount: "0",
      amountExcludingTax: "0",
      paymentMethod: "LUMP_SUM",
      status: opts.status,
      ownerUserId: adminUser.id,
      signerId: adminUser.id,
      // soft delete 仅在测试 ENTITY_IMMUTABLE / NOT_FOUND 时用
      ...(opts.deletedAt ? { deletedAt: opts.deletedAt } : {}),
      attachments: [] as unknown as Parameters<typeof prisma.contract.create>[0]["data"]["attachments"],
      createdById: adminUser.id,
      updatedById: adminUser.id,
    },
  });
  createdContractIds.push(c.id);
  return c;
}

describe("reopenContract 权限校验", () => {
  it("FINANCE → 403 FORBIDDEN", guard(async () => {
    const c = await mkContract({ status: "CLOSED", suffix: "FIN-DENY" });
    await expect(
      reopenContract(buildFinance(), c.id, "data_correction", "test"),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN });
  }));

  it("SALES → 403 FORBIDDEN", guard(async () => {
    const c = await mkContract({ status: "CLOSED", suffix: "SALES-DENY" });
    await expect(
      reopenContract(buildSales(), c.id, "data_correction", "test"),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.FORBIDDEN });
  }));
});

describe("reopenContract 状态机校验", () => {
  it("ACTIVE 合同 → 拒绝 (ENTITY_IMMUTABLE)", guard(async () => {
    const c = await mkContract({ status: "ACTIVE", suffix: "ACTIVE-DENY" });
    await expect(
      reopenContract(buildAdmin(), c.id, "data_correction", "test"),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.ENTITY_IMMUTABLE });
  }));

  it("DRAFT 合同 → 拒绝 (ENTITY_IMMUTABLE)", guard(async () => {
    const c = await mkContract({ status: "DRAFT", suffix: "DRAFT-DENY" });
    await expect(
      reopenContract(buildAdmin(), c.id, "data_correction", "test"),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.ENTITY_IMMUTABLE });
  }));

  it("soft-deleted 合同 → 404", guard(async () => {
    const c = await mkContract({
      status: "CLOSED",
      suffix: "DELETED",
      deletedAt: new Date(),
    });
    await expect(
      reopenContract(buildAdmin(), c.id, "data_correction", "test"),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.NOT_FOUND });
  }));

  it("不存在的合同 → 404", guard(async () => {
    await expect(
      reopenContract(buildAdmin(), "nonexistent_id_xxx", "data_correction", "test"),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.NOT_FOUND });
  }));
});

describe("reopenContract reason 校验", () => {
  it("reason=other 但未填 reasonNote → 400", guard(async () => {
    const c = await mkContract({ status: "CLOSED", suffix: "OTHER-NONOTE" });
    await expect(
      reopenContract(buildAdmin(), c.id, "other"),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));

  it("reason=other + 空白 reasonNote → 400", guard(async () => {
    const c = await mkContract({ status: "CLOSED", suffix: "OTHER-WSPACE" });
    await expect(
      reopenContract(buildAdmin(), c.id, "other", "   "),
    ).rejects.toMatchObject({ errorCode: ERROR_CODES.VALIDATION_FAILED });
  }));
});

describe("reopenContract 成功路径", () => {
  it("ADMIN + CLOSED 合同 → status=ACTIVE, 写 ContractReviewLog + reviewComment 审计标记", guard(async () => {
    const c = await mkContract({ status: "CLOSED", suffix: "SUCCESS-1" });
    const beforeReviewComment = c.reviewComment;

    const updated = await reopenContract(
      buildAdmin(),
      c.id,
      "recovered_from_fake_close",
      "cron 9 个月没跑, 批量恢复 overdue_terminated",
    );

    // 1) 状态更新
    expect(updated.status).toBe("ACTIVE");

    // 2) reviewComment 标记 reopened:<reason>:<note>
    expect(updated.reviewComment).toMatch(/^reopened:recovered_from_fake_close:cron/);

    // 3) ContractReviewLog 写入
    const logs = await prisma.contractReviewLog.findMany({
      where: { contractId: c.id, action: "MANUAL_REOPEN" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.reviewerId).toBe(adminUser!.id);
    expect(logs[0]?.comment).toContain("recovered_from_fake_close");
    expect(logs[0]?.comment).toContain("cron 9 个月");

    // 4) updatedById 改为 admin
    expect(updated.updatedById).toBe(adminUser!.id);

    // 5) 原 reviewComment 不应该是 reopened (除非业务逻辑正好相同)
    // 这里主要确认 audit 痕迹不丢
    expect(beforeReviewComment ?? "").not.toMatch(/^reopened:/);
  }));

  it("reopen 后 createPayment 在该合同上能正常工作 (回归)", guard(async () => {
    // 这个用例验证 reopen + createPayment 联动:
    // reopen 后 contract.status=ACTIVE, 普通 createPayment 应该成功
    // (用于"先 reopen 再正常录回款"的常规流程, 不需要 force)
    const { createPayment } = await import("@/server/services/payment");
    const c = await mkContract({ status: "CLOSED", suffix: "REOPEN-PAY" });
    await reopenContract(buildAdmin(), c.id, "reopen_for_payment");

    // 现在应该可以正常录回款 (不需要 force)
    const p = await createPayment(buildAdmin(), {
      contractId: c.id,
      amount: 5000,
      receivedAt: new Date().toISOString(),
      method: "BANK_TRANSFER",
    });
    expect(p.contractId).toBe(c.id);
    expect(p.status).toBe("PLANNED");
    // 不应该有 FORCE_BACKFILL 标记
    expect(p.remark ?? "").not.toContain("FORCE_BACKFILL");

    // 清理 payment (不在 createdPaymentIds 列表里, 手动删)
    await prisma.payment.delete({ where: { id: p.id } });
  }));
});