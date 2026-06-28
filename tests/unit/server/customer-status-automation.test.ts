// 客户状态机自动化服务 (autoChangeCustomerStatus / revertCustomerStatus) 单元测试
//
// 重点覆盖:
//   - autoChangeCustomerStatus: 5 个 SKIPPED reason (not_found, from_mismatch, r02_failed,
//     r13_failed, rule_mismatch 隐式) + DONE 成功路径 (audit + emit + lastAutoAppliedAt 写)
//   - revertCustomerStatus: 3 个失败路径 (超期 / CURRENT 状态不一致 / 未在窗口内)
//     + 成功路径 (audit + emit + lastAutoAppliedAt 清空)
//
// 策略: vi.hoisted 模拟 prisma.$transaction in-memory 事务, 不打真实 DB.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ERROR_CODES } from "@/types/errors";

// === Hoisted mock 状态 ===
const mockState = vi.hoisted(() => {
  return {
    customer: {
      id: "cust-1",
      status: "NEGOTIATING",
      name: "测试客户",
      ownerUserId: "u-1",
      lastAutoAppliedAt: null as Date | null,
      lastAutoRule: null as string | null
    },
    contractCount: 0,
    paymentCount: 0,
    locked: true,
    auditCalls: [] as Array<{ action: string; before: unknown; after: unknown; actorId: string }>,
    emitted: [] as Array<{ type: string; payload: Record<string, unknown>; receivers: string[] }>,
    txnCalls: 0,
    now: new Date("2026-06-28T10:00:00Z")
  };
});

vi.mock("@/lib/env", () => ({
  env: {
    get CUSTOMER_AUTO_DISPUTE_DAYS() { return 7; }
  }
}));

vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        mockState.txnCalls++;
        const tx = {
          $queryRaw: vi.fn(async (_sql: unknown, ..._args: unknown[]) =>
            mockState.locked ? [{ id: "cust-1" }] : []
          ),
          customer: {
            // 返回拷贝 (而不是引用): 防止 update 改 mockState.customer 后,
            // 之前捕获的 existing 也跟着变 — 这会让 r.from 变成 update 后的状态,
            // 而业务代码期望 r.from = update 前的 status.
            findFirst: vi.fn(async () => {
              if (!mockState.locked) return null;
              return { ...mockState.customer };
            }),
            update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
              // 把 update 的 data 合并回 mockState.customer, 模拟 DB 持久化
              Object.assign(mockState.customer, data);
              return { ...mockState.customer };
            })
          },
          contract: {
            count: vi.fn(async ({ where }: { where: { status?: string | { in: string[] } } }) => {
              const statuses = typeof where.status === "string" ? [where.status] : where.status?.in ?? [];
              if (statuses.includes("ACTIVE")) return mockState.contractCount;
              return 0;
            })
          },
          payment: {
            count: vi.fn(async ({ where }: { where: { status?: string | { in: string[] } } }) => {
              const statuses = typeof where.status === "string" ? [where.status] : where.status?.in ?? [];
              if (statuses.includes("PLANNED") || statuses.includes("CONFIRMED")) return mockState.paymentCount;
              return 0;
            })
          }
        };
        return fn(tx);
      })
    }
  };
});

vi.mock("@/server/audit", () => ({
  audit: vi.fn(async (_tx: unknown, input: { action: string; before?: unknown; after?: unknown; actorId: string }) => {
    mockState.auditCalls.push({
      action: input.action,
      before: input.before,
      after: input.after,
      actorId: input.actorId
    });
  })
}));

vi.mock("@/server/events/bus", () => ({
  emit: vi.fn(async (_txOrP: unknown, ev: { type: string; payload: Record<string, unknown>; receivers: string[] }) => {
    mockState.emitted.push(ev);
    return 1;
  })
}));

import { autoChangeCustomerStatus, revertCustomerStatus } from "@/server/services/customer/status";

const adminUser = {
  id: "u-admin",
  employeeNo: "A1",
  name: "Admin",
  email: "a@x.com",
  roleCode: "ADMIN" as const,
  permissions: []
};

beforeEach(() => {
  mockState.customer = {
    id: "cust-1",
    status: "NEGOTIATING",
    name: "测试客户",
    ownerUserId: "u-1",
    lastAutoAppliedAt: null,
    lastAutoRule: null
  };
  mockState.contractCount = 0;
  mockState.paymentCount = 0;
  mockState.locked = true;
  mockState.auditCalls = [];
  mockState.emitted = [];
  mockState.txnCalls = 0;
});

describe("autoChangeCustomerStatus - SKIPPED 路径", () => {
  it("not_found: 行锁空 (客户已删) → SKIPPED, 不写 audit, 不 emit", async () => {
    mockState.locked = false;
    const r = await autoChangeCustomerStatus({ customerId: "cust-1", rule: "CONTRACT_ACTIVATED" });
    expect(r).toEqual({ result: "SKIPPED", reason: "not_found" });
    expect(mockState.auditCalls).toHaveLength(0);
    expect(mockState.emitted).toHaveLength(0);
  });

  it("from_mismatch: 客户当前状态不在目标状态机的 from 集 → SKIPPED", async () => {
    // LOST 是终态, 不能再自动改; ALLOWED_TRANSITIONS_BY_TARGET["LOST"] 是空集
    mockState.customer = { ...mockState.customer, status: "LOST" };
    const r = await autoChangeCustomerStatus({ customerId: "cust-1", rule: "INACTIVE_LOST" });
    expect(r).toEqual({ result: "SKIPPED", reason: "from_mismatch" });
    expect(mockState.auditCalls).toHaveLength(0);
  });

  it("r02_failed: → SIGNED 但无 ACTIVE 合同 → SKIPPED, 不写", async () => {
    mockState.customer = { ...mockState.customer, status: "NEGOTIATING" };
    mockState.contractCount = 0;
    const r = await autoChangeCustomerStatus({ customerId: "cust-1", rule: "CONTRACT_ACTIVATED" });
    expect(r).toEqual({ result: "SKIPPED", reason: "r02_failed" });
    expect(mockState.auditCalls).toHaveLength(0);
  });

  it("r02_failed 不会发生于 INACTIVE_FROZEN 路径 (规则目标 FROZEN, 不查 ACTIVE 合同数 for SIGNED)", async () => {
    // 这里仅确认 r02_failed 专属 CONTRACT_ACTIVATED; FROZEN 走 r13_failed
    mockState.customer = { ...mockState.customer, status: "NEGOTIATING" };
    mockState.contractCount = 1; // 有 ACTIVE 合同, 应该被 r13_failed 拦下
    const r = await autoChangeCustomerStatus({ customerId: "cust-1", rule: "INACTIVE_FROZEN" });
    expect(r).toEqual({ result: "SKIPPED", reason: "r13_failed" });
  });

  it("r13_failed: → FROZEN 但有 ACTIVE 合同 → SKIPPED", async () => {
    mockState.customer = { ...mockState.customer, status: "SIGNED" };
    mockState.contractCount = 1;
    const r = await autoChangeCustomerStatus({ customerId: "cust-1", rule: "ALL_CONTRACTS_CLOSED" });
    expect(r).toEqual({ result: "SKIPPED", reason: "r13_failed" });
    expect(mockState.auditCalls).toHaveLength(0);
  });

  it("r13_failed: → FROZEN 但有未对账回款 → SKIPPED", async () => {
    mockState.customer = { ...mockState.customer, status: "SIGNED" };
    mockState.contractCount = 0;
    mockState.paymentCount = 1;
    const r = await autoChangeCustomerStatus({ customerId: "cust-1", rule: "ALL_CONTRACTS_CLOSED" });
    expect(r).toEqual({ result: "SKIPPED", reason: "r13_failed" });
  });
});

describe("autoChangeCustomerStatus - DONE 成功路径", () => {
  it("CONTRACT_ACTIVATED (→ SIGNED): 有 ACTIVE 合同 → DONE + audit + emit + 写 lastAutoAppliedAt/lastAutoRule", async () => {
    mockState.customer = { ...mockState.customer, status: "NEGOTIATING" };
    mockState.contractCount = 1;
    const r = await autoChangeCustomerStatus({ customerId: "cust-1", rule: "CONTRACT_ACTIVATED" });
    expect(r).toEqual({ result: "DONE", from: "NEGOTIATING", to: "SIGNED" });
    expect(mockState.customer.status).toBe("SIGNED");
    expect(mockState.customer.lastAutoRule).toBe("CONTRACT_ACTIVATED");
    expect(mockState.customer.lastAutoAppliedAt).toBeInstanceOf(Date);
    // audit
    expect(mockState.auditCalls).toHaveLength(1);
    expect(mockState.auditCalls[0]!.action).toBe("CUSTOMER_STATUS_AUTO_CHANGE");
    expect(mockState.auditCalls[0]!.actorId).toBe("system"); // SYSTEM_USER_ID
    expect(mockState.auditCalls[0]!.before).toEqual({ status: "NEGOTIATING" });
    expect(mockState.auditCalls[0]!.after).toMatchObject({ status: "SIGNED", rule: "CONTRACT_ACTIVATED" });
    // emit
    expect(mockState.emitted).toHaveLength(1);
    expect(mockState.emitted[0]!.type).toBe("CUSTOMER_STATUS_AUTO_APPLIED");
    expect(mockState.emitted[0]!.receivers).toEqual(["u-1"]);
    expect(mockState.emitted[0]!.payload).toMatchObject({
      customerId: "cust-1",
      from: "NEGOTIATING",
      to: "SIGNED",
      rule: "CONTRACT_ACTIVATED"
    });
  });

  it("ALL_CONTRACTS_CLOSED (→ FROZEN): 无合同无回款 → DONE", async () => {
    mockState.customer = { ...mockState.customer, status: "SIGNED" };
    mockState.contractCount = 0;
    mockState.paymentCount = 0;
    const r = await autoChangeCustomerStatus({ customerId: "cust-1", rule: "ALL_CONTRACTS_CLOSED" });
    expect(r).toEqual({ result: "DONE", from: "SIGNED", to: "FROZEN" });
    expect(mockState.customer.lastAutoRule).toBe("ALL_CONTRACTS_CLOSED");
  });
});

describe("revertCustomerStatus - 失败路径", () => {
  it("客户没有 lastAutoAppliedAt (从未自动写过) → 422 CUSTOMER_AUTO_REVERT_TARGET_INVALID", async () => {
    mockState.customer = { ...mockState.customer, lastAutoAppliedAt: null, lastAutoRule: null };
    await expect(revertCustomerStatus(adminUser, { customerId: "cust-1", reason: "测试撤销理由" }))
      .rejects.toMatchObject({ errorCode: ERROR_CODES.CUSTOMER_AUTO_REVERT_TARGET_INVALID });
    expect(mockState.auditCalls).toHaveLength(0);
  });

  it("超过 7 天撤销窗口 → 403 CUSTOMER_AUTO_DISPUTE_EXPIRED", async () => {
    const old = new Date(Date.now() - 8 * 86_400_000);
    mockState.customer = { ...mockState.customer, status: "SIGNED", lastAutoAppliedAt: old, lastAutoRule: "CONTRACT_ACTIVATED" };
    await expect(revertCustomerStatus(adminUser, { customerId: "cust-1", reason: "测试撤销理由" }))
      .rejects.toMatchObject({ errorCode: ERROR_CODES.CUSTOMER_AUTO_DISPUTE_EXPIRED });
    expect(mockState.auditCalls).toHaveLength(0);
  });

  it("当前状态与 lastAutoRule target 不一致 (被人改过) → 422", async () => {
    const recent = new Date(Date.now() - 1000);
    // lastAutoRule=CONTRACT_ACTIVATED → target=SIGNED, 但实际 status=NEGOTIATING
    mockState.customer = { ...mockState.customer, status: "NEGOTIATING", lastAutoAppliedAt: recent, lastAutoRule: "CONTRACT_ACTIVATED" };
    await expect(revertCustomerStatus(adminUser, { customerId: "cust-1", reason: "测试撤销理由" }))
      .rejects.toMatchObject({ errorCode: ERROR_CODES.CUSTOMER_AUTO_REVERT_TARGET_INVALID });
    expect(mockState.auditCalls).toHaveLength(0);
  });

  it("SALES 撤销非自己的客户 → 404 NOT_FOUND (行锁空)", async () => {
    const salesUser = { ...adminUser, id: "u-sales", roleCode: "SALES" as const };
    // mock 行锁空: 让 ownerClause 命中不到
    mockState.locked = true;
    // mockState.customer.ownerUserId === "u-1" != salesUser.id="u-sales", mock 的 ownerClause 路径:
    //   - $queryRaw 加 ownerClause 时, mock 不会 honor, 仍返回 [{ id: "cust-1" }]
    //   - 但 findFirst 走 ownerEq(user) — mock 也不 honor, 仍返回 customer
    // 因此用 mockState.locked=false 模拟"行锁空"分支
    mockState.locked = false;
    const recent = new Date(Date.now() - 1000);
    mockState.customer = { ...mockState.customer, status: "SIGNED", lastAutoAppliedAt: recent, lastAutoRule: "CONTRACT_ACTIVATED" };
    await expect(revertCustomerStatus(salesUser, { customerId: "cust-1", reason: "测试撤销理由" }))
      .rejects.toMatchObject({ errorCode: ERROR_CODES.NOT_FOUND });
  });
});

describe("revertCustomerStatus - 成功路径", () => {
  it("CONTRACT_ACTIVATED (→ SIGNED → FROZEN) 撤销: audit + emit + 清 lastAutoAppliedAt/lastAutoRule", async () => {
    const recent = new Date(Date.now() - 60_000);
    mockState.customer = {
      ...mockState.customer,
      status: "SIGNED",
      lastAutoAppliedAt: recent,
      lastAutoRule: "CONTRACT_ACTIVATED"
    };
    const result = await revertCustomerStatus(adminUser, { customerId: "cust-1", reason: "撤销原因测试" });
    expect(result).toEqual({ customerId: "cust-1", from: "SIGNED", to: "FROZEN" });
    // mock 持久化已合并回 customer
    expect(mockState.customer.status).toBe("FROZEN");
    expect(mockState.customer.lastAutoAppliedAt).toBeNull();
    expect(mockState.customer.lastAutoRule).toBeNull();
    // audit
    expect(mockState.auditCalls).toHaveLength(1);
    expect(mockState.auditCalls[0]!.action).toBe("CUSTOMER_STATUS_REVERT");
    expect(mockState.auditCalls[0]!.actorId).toBe("u-admin");
    expect(mockState.auditCalls[0]!.after).toMatchObject({
      status: "FROZEN",
      reason: "撤销原因测试",
      revertedFrom: "SIGNED",
      revertedRule: "CONTRACT_ACTIVATED"
    });
    // emit
    expect(mockState.emitted).toHaveLength(1);
    expect(mockState.emitted[0]!.type).toBe("CUSTOMER_STATUS_AUTO_REVERTED");
    expect(mockState.emitted[0]!.receivers).toEqual(["u-1"]);
    expect(mockState.emitted[0]!.payload).toMatchObject({
      customerId: "cust-1",
      from: "SIGNED",
      to: "FROZEN",
      reason: "撤销原因测试"
    });
  });

  it("INACTIVE_LOST (→ LOST → NEGOTIATING) 撤销: 走 NEGOTIATING 而非 FROZEN", async () => {
    const recent = new Date(Date.now() - 60_000);
    mockState.customer = {
      ...mockState.customer,
      status: "LOST",
      lastAutoAppliedAt: recent,
      lastAutoRule: "INACTIVE_LOST"
    };
    const result = await revertCustomerStatus(adminUser, { customerId: "cust-1", reason: "该客户还有合作意向" });
    expect(result).toEqual({ customerId: "cust-1", from: "LOST", to: "NEGOTIATING" });
    expect(mockState.customer.status).toBe("NEGOTIATING");
    expect(mockState.auditCalls[0]!.after).toMatchObject({ status: "NEGOTIATING", revertedRule: "INACTIVE_LOST" });
  });

  it("INACTIVE_FROZEN (→ FROZEN → NEGOTIATING) 撤销: 走 NEGOTIATING", async () => {
    const recent = new Date(Date.now() - 60_000);
    mockState.customer = {
      ...mockState.customer,
      status: "FROZEN",
      lastAutoAppliedAt: recent,
      lastAutoRule: "INACTIVE_FROZEN"
    };
    const result = await revertCustomerStatus(adminUser, { customerId: "cust-1", reason: "误判, 客户近期有互动" });
    expect(result).toEqual({ customerId: "cust-1", from: "FROZEN", to: "NEGOTIATING" });
  });

  it("ALL_CONTRACTS_CLOSED (→ FROZEN → NEGOTIATING) 撤销: 走 NEGOTIATING", async () => {
    const recent = new Date(Date.now() - 60_000);
    mockState.customer = {
      ...mockState.customer,
      status: "FROZEN",
      lastAutoAppliedAt: recent,
      lastAutoRule: "ALL_CONTRACTS_CLOSED"
    };
    const result = await revertCustomerStatus(adminUser, { customerId: "cust-1", reason: "合同已续约" });
    expect(result).toEqual({ customerId: "cust-1", from: "FROZEN", to: "NEGOTIATING" });
  });
});
