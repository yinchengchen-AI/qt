// tickCustomerStatusSuggestions job 单元测试
//
// 用 vi.mock 拦截 prisma 和 emit, 验证:
//   - LEAD 客户无合同 + 90 天无活动 → 发 CUSTOMER_STATUS_SUGGEST 消息, suggestedStatus=LOST
//   - 同一客户同日第二次跑 → 0 条 (去重生效)
//   - SIGNED 客户有未对账回款 → 不建议 FROZEN
//
// "活动" 信号 = max(contract.signDate, contract.endDate[CLOSED], payment.receivedAt[active], customer.updatedAt, customer.createdAt)
// follow-up 功能已下线, 改用 lastActivityAt (取代 lastFollowAt)
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  customers: [] as Array<{
    id: string;
    name: string;
    status: string;
    ownerUserId: string;
    createdAt: Date;
    updatedAt: Date;
    contracts: Array<{ status: string; signDate: Date; endDate: Date | null }>;
  }>,
  payments: [] as Array<{ customerId: string; receivedAt: Date; status: string }>,
  messages: [] as Array<{ type: string; receiverUserId: string; link: unknown; createdAt: Date }>,
  emitted: [] as Array<{ type: string; payload: Record<string, unknown>; receivers: string[] }>
}));

vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      customer: {
        findMany: vi.fn(async () => mockState.customers)
      },
      payment: {
        findMany: vi.fn(async () => mockState.payments)
      },
      message: {
        // 镜像 job 的批量化去重查询:
        //   where: { type, receiverUserId: { in }, createdAt: { gte today } }
        // 业务侧在 JS 里按 link.id + link.suggest 做二次过滤
        findMany: vi.fn(async (args: { where: { type?: string; receiverUserId?: { in: string[] }; createdAt?: { gte: Date } } }) => {
          const today = args.where.createdAt?.gte ?? new Date(0);
          return mockState.messages.filter((m) => {
            if (args.where.type && m.type !== args.where.type) return false;
            if (args.where.receiverUserId && !args.where.receiverUserId.in.includes(m.receiverUserId)) return false;
            if (m.createdAt < today) return false;
            return true;
          });
        })
      }
    }
  };
});

vi.mock("@/server/events/bus", () => {
  return {
    emit: vi.fn(async (_p: unknown, ev: { type: string; payload: Record<string, unknown>; receivers: string[] }): Promise<number> => {
      mockState.emitted.push(ev);
      mockState.messages.push({
        type: ev.type,
        receiverUserId: ev.receivers[0] ?? "",
        link: { id: ev.payload.customerId, suggest: ev.payload.suggestedStatus },
        createdAt: new Date()
      });
      return 1;
    })
  };
});

import { tickCustomerStatusSuggestions } from "@/server/jobs/customer-status-suggest";

const now = new Date("2026-06-23T10:00:00Z");
const oldCreated = new Date("2025-01-01T00:00:00Z"); // 远超 90 天前, 作为 customer.createdAt / updatedAt 兜底
const recentUpdated = new Date("2026-06-10T00:00:00Z"); // 13 天前
// 150 天前结清的合同: 超过 LOST 90 天阈, 也超过 FROZEN 60 天阈, 同时满足 allClosedOverGrace (≥ 30)
const oldClosedEnd = new Date("2026-01-24T00:00:00Z");

beforeEach(() => {
  mockState.customers = [];
  mockState.payments = [];
  mockState.messages = [];
  mockState.emitted = [];
});

describe("tickCustomerStatusSuggestions - 规则 1 (建议 LOST)", () => {
  it("LEAD 客户无合同 + 90 天无活动 → 1 条 LOST 建议", async () => {
    mockState.customers = [
      {
        id: "c-1",
        name: "客户 A",
        status: "LEAD",
        ownerUserId: "u-1",
        createdAt: oldCreated,
        updatedAt: oldCreated, // 兜底, max(updatedAt, createdAt) = oldCreated
        contracts: []
      }
    ];
    const r = await tickCustomerStatusSuggestions(now);
    expect(r.scanned).toBe(1);
    expect(r.created).toBe(1);
    expect(mockState.emitted[0]!.type).toBe("CUSTOMER_STATUS_SUGGEST");
    expect(mockState.emitted[0]!.payload.suggestedStatus).toBe("LOST");
    expect(mockState.emitted[0]!.receivers).toEqual(["u-1"]);
  });

  it("LEAD 客户有 ACTIVE 合同 → 不建议 LOST", async () => {
    mockState.customers = [
      {
        id: "c-1",
        name: "客户 A",
        status: "LEAD",
        ownerUserId: "u-1",
        createdAt: oldCreated,
        updatedAt: oldCreated,
        contracts: [{ status: "ACTIVE", signDate: oldCreated, endDate: null }]
      }
    ];
    const r = await tickCustomerStatusSuggestions(now);
    expect(r.created).toBe(0);
  });

  it("LEAD 客户 30 天内有活动 (customer.updatedAt 较新) → 不建议 LOST", async () => {
    mockState.customers = [
      {
        id: "c-1",
        name: "客户 A",
        status: "LEAD",
        ownerUserId: "u-1",
        createdAt: oldCreated,
        updatedAt: recentUpdated, // 13 天前, lastActivityAt = updatedAt, 活动 < 90 天
        contracts: []
      }
    ];
    const r = await tickCustomerStatusSuggestions(now);
    expect(r.created).toBe(0);
  });

  // 注: mock 不 honor Prisma where 过滤, scanned 反映 mock 返回的行数;
  //   业务过滤的真正测试在 E2E + 集成测试里覆盖, 这里只测 job 内的规则逻辑.
});

describe("tickCustomerStatusSuggestions - 规则 2 (建议 FROZEN)", () => {
  it("SIGNED 客户所有合同 CLOSED ≥ 30 天 + 60 天无活动 + 无未对账回款 → 建议 FROZEN (并同时建议 LOST)", async () => {
    mockState.customers = [
      {
        id: "c-1",
        name: "客户 A",
        status: "SIGNED",
        ownerUserId: "u-1",
        createdAt: oldCreated,
        updatedAt: oldCreated,
        contracts: [
          // endDate 距 now 150 天 > 90 天 LOST 阈, 合同 closed 也 30 天+
          { status: "CLOSED", signDate: new Date("2025-06-01T00:00:00Z"), endDate: oldClosedEnd }
        ]
      }
    ];
    mockState.payments = []; // 无未对账回款
    const r = await tickCustomerStatusSuggestions(now);
    // 规则 1 (LOST): hasActiveContract=false, lastActivityAt = oldClosedEnd, 活动 ≥ 90 天 → 命中
    // 规则 2 (FROZEN): allClosedOverGrace=true, 活动 ≥ 60 天, 无未对账回款 → 命中
    expect(r.created).toBe(2);
    const frozen = mockState.emitted.find((e) => e.payload.suggestedStatus === "FROZEN");
    expect(frozen).toBeDefined();
    expect(frozen!.payload.customerId).toBe("c-1");
  });

  it("SIGNED 客户有未对账回款 → 不建议 FROZEN (但可能仍建议 LOST)", async () => {
    mockState.customers = [
      {
        id: "c-1",
        name: "客户 A",
        status: "SIGNED",
        ownerUserId: "u-1",
        createdAt: oldCreated,
        updatedAt: oldCreated,
        contracts: [
          { status: "CLOSED", signDate: new Date("2025-06-01T00:00:00Z"), endDate: oldClosedEnd }
        ]
      }
    ];
    mockState.payments = [{ customerId: "c-1", receivedAt: new Date("2026-05-01T00:00:00Z"), status: "CONFIRMED" }];
    await tickCustomerStatusSuggestions(now);
    // LOST 规则需要 "无 ACTIVE 合同" (CLOSED 算非 ACTIVE), 所以会建议 LOST; 但不会建议 FROZEN
    const fr = mockState.emitted.find((e) => e.payload.suggestedStatus === "FROZEN");
    expect(fr).toBeUndefined();
  });
});

describe("tickCustomerStatusSuggestions - 候选扫描", () => {
  it("无候选客户时, 不触发 emit, 返回 scanned=0", async () => {
    mockState.customers = [];
    const r = await tickCustomerStatusSuggestions(now);
    expect(r.scanned).toBe(0);
    expect(mockState.emitted).toHaveLength(0);
  });
});

describe("tickCustomerStatusSuggestions - 去重", () => {
  it("同客户同日第二次跑 → created=0 (第一次已发过)", async () => {
    mockState.customers = [
      {
        id: "c-1",
        name: "客户 A",
        status: "LEAD",
        ownerUserId: "u-1",
        createdAt: oldCreated,
        updatedAt: oldCreated,
        contracts: []
      }
    ];
    const r1 = await tickCustomerStatusSuggestions(now);
    expect(r1.created).toBe(1);
    const r2 = await tickCustomerStatusSuggestions(now);
    expect(r2.created).toBe(0);
  });
});
