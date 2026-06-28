// tickCustomerStatusSuggestions job 单元测试
//
// 用 vi.mock 拦截 prisma / emit / autoChangeCustomerStatus, 验证:
//   - 规则开启 + auto-write DONE → applied++ 1, 不发 SUGGEST
//   - 规则开启 + auto-write SKIPPED → fallthrough 到 SUGGEST, suggestionsKept++ 1
//   - 规则关闭 (env CUSTOMER_AUTO_RULES_DISABLED) → 直接走 SUGGEST
//   - 同一客户同日第二次跑 → 0 条 (去重生效)
//   - LEAD 客户无合同 + 90 天无活动 → 1 条 LOST SUGGEST
//   - SIGNED 客户有未对账回款 → 不建议 FROZEN
//
// "活动" 信号 = max(contract.signDate, contract.endDate[CLOSED], payment.receivedAt[active],
//                   customer.updatedAt, customer.createdAt)
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
  emitted: [] as Array<{ type: string; payload: Record<string, unknown>; receivers: string[] }>,
  // auto-write mock 的逐 customer 返回
  autoResults: new Map<string, "DONE" | "SKIPPED">(),
  autoCalls: [] as Array<{ customerId: string; rule: string }>
}));

const mockEnv = vi.hoisted(() => ({
  CUSTOMER_AUTO_RULES_DISABLED: "",
  CUSTOMER_AUTO_INACTIVE_LOST_DAYS: 90,
  CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS: 60
}));

vi.mock("@/lib/env", () => ({
  env: {
    get CUSTOMER_AUTO_RULES_DISABLED() { return mockEnv.CUSTOMER_AUTO_RULES_DISABLED; },
    get CUSTOMER_AUTO_INACTIVE_LOST_DAYS() { return mockEnv.CUSTOMER_AUTO_INACTIVE_LOST_DAYS; },
    get CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS() { return mockEnv.CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS; }
  }
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

vi.mock("@/server/events/bus", () => ({
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
}));

// 直接 mock autoChangeCustomerStatus: 测 job 内的「先尝试 auto-write, 失败 fallthrough」逻辑
vi.mock("@/server/services/customer/status", () => ({
  autoChangeCustomerStatus: vi.fn(async (input: { customerId: string; rule: string }) => {
    mockState.autoCalls.push({ customerId: input.customerId, rule: input.rule });
    const r = mockState.autoResults.get(input.customerId) ?? "SKIPPED";
    return r === "DONE"
      ? { result: "DONE", from: "NEGOTIATING", to: "LOST" }
      : { result: "SKIPPED", reason: "r02_failed" };
  })
}));

import { tickCustomerStatusSuggestions } from "@/server/jobs/customer-status-suggest";

const now = new Date("2026-06-23T10:00:00Z");
const oldCreated = new Date("2025-01-01T00:00:00Z");
const recentUpdated = new Date("2026-06-10T00:00:00Z");
const oldClosedEnd = new Date("2026-01-24T00:00:00Z");

beforeEach(() => {
  mockState.customers = [];
  mockState.payments = [];
  mockState.messages = [];
  mockState.emitted = [];
  mockState.autoResults.clear();
  mockState.autoCalls = [];
  mockEnv.CUSTOMER_AUTO_RULES_DISABLED = "";
  mockEnv.CUSTOMER_AUTO_INACTIVE_LOST_DAYS = 90;
  mockEnv.CUSTOMER_AUTO_INACTIVE_FROZEN_DAYS = 60;
});

describe("tickCustomerStatusSuggestions - 规则 1 (LOST)", () => {
  it("LEAD 客户无合同 + 90 天无活动 + 规则关闭 → 1 条 LOST SUGGEST, 不调 auto-write", async () => {
    mockEnv.CUSTOMER_AUTO_RULES_DISABLED = "INACTIVE_LOST";
    mockState.customers = [
      { id: "c-1", name: "客户 A", status: "LEAD", ownerUserId: "u-1", createdAt: oldCreated, updatedAt: oldCreated, contracts: [] }
    ];
    const r = await tickCustomerStatusSuggestions(now);
    expect(r.scanned).toBe(1);
    expect(r.suggestionsKept).toBe(1);
    expect(r.applied).toBe(0);
    expect(mockState.autoCalls).toHaveLength(0); // 规则关闭, 跳过 auto-write
    expect(mockState.emitted[0]!.type).toBe("CUSTOMER_STATUS_SUGGEST");
    expect(mockState.emitted[0]!.payload.suggestedStatus).toBe("LOST");
  });

  it("LEAD 客户无合同 + 90 天无活动 + 规则开启 + auto-write DONE → applied=1, 不发 SUGGEST", async () => {
    mockState.customers = [
      { id: "c-1", name: "客户 A", status: "LEAD", ownerUserId: "u-1", createdAt: oldCreated, updatedAt: oldCreated, contracts: [] }
    ];
    mockState.autoResults.set("c-1", "DONE");
    const r = await tickCustomerStatusSuggestions(now);
    expect(r.applied).toBe(1);
    expect(r.suggestionsKept).toBe(0);
    expect(mockState.autoCalls).toEqual([{ customerId: "c-1", rule: "INACTIVE_LOST" }]);
    expect(mockState.emitted).toHaveLength(0);
  });

  it("LEAD 客户无合同 + 90 天无活动 + 规则开启 + auto-write SKIPPED → fallthrough 到 SUGGEST", async () => {
    mockState.customers = [
      { id: "c-1", name: "客户 A", status: "LEAD", ownerUserId: "u-1", createdAt: oldCreated, updatedAt: oldCreated, contracts: [] }
    ];
    // mockState.autoResults 默认 SKIPPED
    const r = await tickCustomerStatusSuggestions(now);
    expect(r.applied).toBe(0);
    expect(r.suggestionsKept).toBe(1);
    expect(mockState.autoCalls).toEqual([{ customerId: "c-1", rule: "INACTIVE_LOST" }]);
    expect(mockState.emitted[0]!.type).toBe("CUSTOMER_STATUS_SUGGEST");
  });

  it("LEAD 客户有 ACTIVE 合同 → 不走 LOST 路径", async () => {
    mockState.customers = [
      { id: "c-1", name: "客户 A", status: "LEAD", ownerUserId: "u-1", createdAt: oldCreated, updatedAt: oldCreated,
        contracts: [{ status: "ACTIVE", signDate: oldCreated, endDate: null }] }
    ];
    const r = await tickCustomerStatusSuggestions(now);
    expect(r.suggestionsKept).toBe(0);
    expect(r.applied).toBe(0);
    expect(mockState.autoCalls).toHaveLength(0);
  });

  it("LEAD 客户 30 天内有活动 (customer.updatedAt 较新) → 不建议 LOST", async () => {
    mockState.customers = [
      { id: "c-1", name: "客户 A", status: "LEAD", ownerUserId: "u-1", createdAt: oldCreated, updatedAt: recentUpdated, contracts: [] }
    ];
    const r = await tickCustomerStatusSuggestions(now);
    expect(r.suggestionsKept).toBe(0);
    expect(r.applied).toBe(0);
  });
});

describe("tickCustomerStatusSuggestions - 规则 2 (FROZEN)", () => {
  it("SIGNED 客户所有合同 CLOSED ≥ 30 天 + 60 天无活动 + 无未对账回款 + 规则开启 + auto-write DONE → applied=1, 不发 FROZEN SUGGEST", async () => {
    mockState.customers = [
      { id: "c-1", name: "客户 A", status: "SIGNED", ownerUserId: "u-1", createdAt: oldCreated, updatedAt: oldCreated,
        contracts: [{ status: "CLOSED", signDate: new Date("2025-06-01T00:00:00Z"), endDate: oldClosedEnd }] }
    ];
    mockState.payments = [];
    mockState.autoResults.set("c-1", "DONE");
    const r = await tickCustomerStatusSuggestions(now);
    // LOST 规则先评估: hasActiveContract=false, lastActivityAt=oldClosedEnd, 150 天 > 90 → 命中
    //   → auto-write 尝试 → mock DONE → applied++ ; continue; (跳过 FROZEN 规则)
    // FROZEN 规则在同一 for 循环中不执行 (job 用 continue 短路). 所以 applied=1, emitted=0.
    expect(r.applied).toBe(1);
    expect(r.suggestionsKept).toBe(0);
    expect(mockState.emitted).toHaveLength(0);
  });

  it("SIGNED 客户有未对账回款 → 不建议 FROZEN (但可能仍建议 LOST)", async () => {
    mockState.customers = [
      { id: "c-1", name: "客户 A", status: "SIGNED", ownerUserId: "u-1", createdAt: oldCreated, updatedAt: oldCreated,
        contracts: [{ status: "CLOSED", signDate: new Date("2025-06-01T00:00:00Z"), endDate: oldClosedEnd }] }
    ];
    mockState.payments = [{ customerId: "c-1", receivedAt: new Date("2026-05-01T00:00:00Z"), status: "CONFIRMED" }];
    await tickCustomerStatusSuggestions(now);
    // FROZEN 规则因 hasPlannedOrConfirmedPayment=true 不进; LOST 规则仍会进 (但 mock auto-write 默认 SKIPPED, 会 fallthrough 发 SUGGEST)
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
    expect(mockState.autoCalls).toHaveLength(0);
  });
});

describe("tickCustomerStatusSuggestions - 去重", () => {
  it("同客户同日第二次跑 SUGGEST → 0 (auto-write 已生效时也不重复发)", async () => {
    mockState.customers = [
      { id: "c-1", name: "客户 A", status: "LEAD", ownerUserId: "u-1", createdAt: oldCreated, updatedAt: oldCreated, contracts: [] }
    ];
    // 第一次: SKIPPED → 发 SUGGEST
    const r1 = await tickCustomerStatusSuggestions(now);
    expect(r1.suggestionsKept).toBe(1);
    // 第二次: SUGGEST 已发, 跳过
    const r2 = await tickCustomerStatusSuggestions(now);
    expect(r2.suggestionsKept).toBe(0);
    expect(r2.applied).toBe(0);
  });
});
