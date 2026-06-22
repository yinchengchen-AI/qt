// 客户状态变更服务 (changeCustomerStatus) 单元测试
//
// 用 vi.mock 拦截 prisma.$transaction 和 audit, 不依赖真实 DB, 跑得快.
// 重点覆盖: 迁移合法性 (CUSTOMER_STATUS_TRANSITION_INVALID) + R-02 (SIGNED 需合同) +
//           R-13 (FROZEN 需无活跃合同 + 无未对账回款) + audit 行为
//
// 注: changeCustomerStatus 来自 server/services/customer.ts, 它在事务里做了:
//   1) FOR UPDATE 行锁
//   2) 加载 existing (含 status)
//   3) assertCanTransition(existing.status, status)
//   4) R-02 / R-13 业务校验
//   5) tx.customer.update
//   6) audit(CUSTOMER_STATUS_CHANGE)
// 这里把这套流程在 in-memory 假事务中跑通, 不真正打 DB.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

// === Hoisted mock 状态: vi.mock 在模块求值前就会被 hoist, 所以变量必须 vi.hoisted ===
const mockState = vi.hoisted(() => {
  return {
    customer: { id: "cust-1", status: "LEAD", name: "X", ownerUserId: "u-1" } as Record<string, unknown>,
    contractCount: 0,
    paymentCount: 0,
    locked: true,
    auditCalls: [] as Array<{ action: string; before: unknown; after: unknown }>,
    txnCalls: 0
  };
});

vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
        mockState.txnCalls++;
        const tx = {
          $queryRaw: vi.fn(async () => (mockState.locked ? [{ id: "cust-1" }] : [])),
          customer: {
            findFirst: vi.fn(async () => mockState.customer),
            update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
              return { ...mockState.customer, ...data, id: "cust-1" };
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
            count: vi.fn(async () => mockState.paymentCount)
          }
        };
        return fn(tx);
      })
    }
  };
});

vi.mock("@/server/audit", () => {
  return {
    audit: vi.fn(async (_tx: unknown, input: { action: string; before?: unknown; after?: unknown }) => {
      mockState.auditCalls.push({ action: input.action, before: input.before, after: input.after });
    })
  };
});

vi.mock("@/lib/rls", () => {
  return {
    rlsTransaction: vi.fn(async (_p: unknown, _u: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({}))
  };
});

import { changeCustomerStatus } from "@/server/services/customer";

const adminUser = {
  id: "u-admin",
  employeeNo: "A1",
  name: "Admin",
  email: "a@x.com",
  roleCode: "ADMIN" as const,
  permissions: []
};

beforeEach(() => {
  mockState.customer = { id: "cust-1", status: "LEAD", name: "X", ownerUserId: "u-1" };
  mockState.contractCount = 0;
  mockState.paymentCount = 0;
  mockState.locked = true;
  mockState.auditCalls = [];
  mockState.txnCalls = 0;
});

describe("changeCustomerStatus - 迁移合法性 (CUSTOMER_STATUS_TRANSITION_INVALID)", () => {
  it("SIGNED → LEAD: 抛 CUSTOMER_STATUS_TRANSITION_INVALID, audit 不写, 事务已开", async () => {
    mockState.customer = { id: "cust-1", status: "SIGNED", name: "X", ownerUserId: "u-1" };
    await expect(changeCustomerStatus(adminUser, "cust-1", "LEAD")).rejects.toMatchObject({
      errorCode: ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID
    });
    expect(mockState.auditCalls).toHaveLength(0);
    expect(mockState.txnCalls).toBe(1);
  });

  it("LEAD → FROZEN: 抛 CUSTOMER_STATUS_TRANSITION_INVALID", async () => {
    mockState.customer = { id: "cust-1", status: "LEAD", name: "X", ownerUserId: "u-1" };
    await expect(changeCustomerStatus(adminUser, "cust-1", "FROZEN")).rejects.toMatchObject({
      errorCode: ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID
    });
  });

  it("非法目标字符串 'BOGUS': 抛 CUSTOMER_STATUS_TRANSITION_INVALID", async () => {
    mockState.customer = { id: "cust-1", status: "LEAD", name: "X", ownerUserId: "u-1" };
    await expect(changeCustomerStatus(adminUser, "cust-1", "BOGUS")).rejects.toMatchObject({
      errorCode: ERROR_CODES.CUSTOMER_STATUS_TRANSITION_INVALID
    });
  });
});

describe("changeCustomerStatus - R-02 (→ SIGNED 需合同)", () => {
  it("LEAD → SIGNED 无合同: 抛 CUSTOMER_STATUS_INVALID, audit 不写", async () => {
    mockState.customer = { id: "cust-1", status: "LEAD", name: "X", ownerUserId: "u-1" };
    mockState.contractCount = 0;
    await expect(changeCustomerStatus(adminUser, "cust-1", "SIGNED")).rejects.toBeInstanceOf(ApiError);
    expect(mockState.auditCalls).toHaveLength(0);
  });

  it("LEAD → SIGNED 有 ACTIVE 合同: 成功, audit 写 CUSTOMER_STATUS_CHANGE", async () => {
    mockState.customer = { id: "cust-1", status: "LEAD", name: "X", ownerUserId: "u-1" };
    mockState.contractCount = 1;
    await changeCustomerStatus(adminUser, "cust-1", "SIGNED");
    expect(mockState.auditCalls).toHaveLength(1);
    expect(mockState.auditCalls[0]!.action).toBe("CUSTOMER_STATUS_CHANGE");
    expect(mockState.auditCalls[0]!.before).toEqual({ status: "LEAD" });
    expect(mockState.auditCalls[0]!.after).toMatchObject({ status: "SIGNED" });
  });

  it("LEAD → SIGNED 只有 CLOSED 合同: 仍抛 CUSTOMER_STATUS_INVALID (R-02 要求生效中)", async () => {
    mockState.customer = { id: "cust-1", status: "LEAD", name: "X", ownerUserId: "u-1" };
    mockState.contractCount = 0; // mock 里 CLOSED 合同不计入
    await expect(changeCustomerStatus(adminUser, "cust-1", "SIGNED")).rejects.toMatchObject({
      errorCode: ERROR_CODES.CUSTOMER_STATUS_INVALID
    });
  });
});

describe("changeCustomerStatus - R-13 (→ FROZEN 需无活跃合同 + 无未对账回款)", () => {
  it("NEGOTIATING → FROZEN 有 ACTIVE 合同: 抛 CUSTOMER_HAS_ACTIVE_CONTRACT (需要先传 reason 才会进入合同检查)", async () => {
    mockState.customer = { id: "cust-1", status: "NEGOTIATING", name: "X", ownerUserId: "u-1" };
    mockState.contractCount = 1;
    await expect(changeCustomerStatus(adminUser, "cust-1", "FROZEN", "测试冻结")).rejects.toMatchObject({
      errorCode: ERROR_CODES.CUSTOMER_HAS_ACTIVE_CONTRACT
    });
    expect(mockState.auditCalls).toHaveLength(0);
  });

  it("SIGNED → FROZEN 无合同但有 PLANNED 支付: 抛 CUSTOMER_FROZEN_ACTIVE_PAYMENT", async () => {
    mockState.customer = { id: "cust-1", status: "SIGNED", name: "X", ownerUserId: "u-1" };
    mockState.contractCount = 0;
    mockState.paymentCount = 1;
    await expect(changeCustomerStatus(adminUser, "cust-1", "FROZEN", "测试冻结")).rejects.toMatchObject({
      errorCode: ERROR_CODES.CUSTOMER_FROZEN_ACTIVE_PAYMENT
    });
    expect(mockState.auditCalls).toHaveLength(0);
  });

  it("SIGNED → FROZEN 无合同无支付 + 传 reason: 成功, audit 写 diff", async () => {
    mockState.customer = { id: "cust-1", status: "SIGNED", name: "X", ownerUserId: "u-1" };
    mockState.contractCount = 0;
    mockState.paymentCount = 0;
    await changeCustomerStatus(adminUser, "cust-1", "FROZEN", "合规冻结");
    expect(mockState.auditCalls[0]!.after).toEqual({ status: "FROZEN", reason: "合规冻结" });
  });
});

describe("changeCustomerStatus - audit diff 含 reason", () => {
  it("提供 reason 时, audit.after 含 reason 字段", async () => {
    mockState.customer = { id: "cust-1", status: "LEAD", name: "X", ownerUserId: "u-1" };
    mockState.contractCount = 1;
    await changeCustomerStatus(adminUser, "cust-1", "SIGNED", "客户确认合作");
    expect(mockState.auditCalls[0]!.after).toEqual({ status: "SIGNED", reason: "客户确认合作" });
  });
});

describe("changeCustomerStatus - 终态变更必填 reason (LOST/FROZEN)", () => {
  it("LEAD → LOST 不传 reason: 抛 CUSTOMER_STATUS_REASON_REQUIRED", async () => {
    mockState.customer = { id: "cust-1", status: "LEAD", name: "X", ownerUserId: "u-1" };
    await expect(changeCustomerStatus(adminUser, "cust-1", "LOST")).rejects.toMatchObject({
      errorCode: ERROR_CODES.CUSTOMER_STATUS_REASON_REQUIRED
    });
    expect(mockState.auditCalls).toHaveLength(0);
  });

  it("SIGNED → FROZEN 不传 reason: 抛 CUSTOMER_STATUS_REASON_REQUIRED", async () => {
    mockState.customer = { id: "cust-1", status: "SIGNED", name: "X", ownerUserId: "u-1" };
    mockState.contractCount = 0;
    mockState.paymentCount = 0;
    await expect(changeCustomerStatus(adminUser, "cust-1", "FROZEN")).rejects.toMatchObject({
      errorCode: ERROR_CODES.CUSTOMER_STATUS_REASON_REQUIRED
    });
  });

  it("LEAD → LOST 传 reason: 成功, audit.after 含 reason", async () => {
    mockState.customer = { id: "cust-1", status: "LEAD", name: "X", ownerUserId: "u-1" };
    await changeCustomerStatus(adminUser, "cust-1", "LOST", "客户明确拒绝");
    expect(mockState.auditCalls[0]!.action).toBe("CUSTOMER_STATUS_CHANGE");
    expect(mockState.auditCalls[0]!.after).toEqual({ status: "LOST", reason: "客户明确拒绝" });
  });

  it("LEAD → NEGOTIATING 不传 reason: 成功 (非终态不需要)", async () => {
    mockState.customer = { id: "cust-1", status: "LEAD", name: "X", ownerUserId: "u-1" };
    await changeCustomerStatus(adminUser, "cust-1", "NEGOTIATING");
    expect(mockState.auditCalls[0]!.after).toEqual({ status: "NEGOTIATING" });
  });
});

describe("changeCustomerStatus - 行锁 (FOR UPDATE)", () => {
  it("锁不到行时抛 NOT_FOUND", async () => {
    mockState.locked = false;
    await expect(changeCustomerStatus(adminUser, "cust-1", "SIGNED")).rejects.toMatchObject({
      errorCode: ERROR_CODES.NOT_FOUND
    });
  });
});
