// 领域事件总线单元测试
//
// 覆盖:
//   - emit 一次性 createMany 写入消息
//   - buildMessage 各分支 title/content/link 正确
//   - link 额外字段（如 suggest）透传
//   - dispatchExternalChannels fire-and-forget 触发
//   - 未处理事件类型抛错
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  createManyCalls: [] as Array<{ data: Array<Record<string, unknown>> }>,
  dispatchCalls: [] as Array<{ type: string; messages: Array<Record<string, unknown>> }>
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: {
      createMany: vi.fn(async (args: { data: Array<Record<string, unknown>> }) => {
        mockState.createManyCalls.push(args);
        return { count: args.data.length };
      })
    }
  }
}));

import { prisma } from "@/lib/prisma";

vi.mock("@/server/events/dispatcher", () => ({
  dispatchExternalChannels: vi.fn(async (_event: unknown, messages: Array<Record<string, unknown>>) => {
    mockState.dispatchCalls.push({ type: (messages[0]?.type as string) ?? "unknown", messages });
  })
}));

import { emit, type DomainEvent } from "@/server/events/bus";

beforeEach(() => {
  mockState.createManyCalls = [];
  mockState.dispatchCalls = [];
});

const makeEvent = (type: DomainEvent["type"], payload: Record<string, unknown>, receivers: string[]): DomainEvent => ({
  type,
  payload,
  receivers
});

describe("emit", () => {
  it("空接收人直接返回 0", async () => {
    const r = await emit(prisma, makeEvent("PAYMENT_RECEIVED", { amount: 100 }, []));
    expect(r).toBe(0);
    expect(mockState.createManyCalls).toHaveLength(0);
  });

  it("createMany 批量写入并触发外部通道", async () => {
    const ev = makeEvent("PAYMENT_RECEIVED", { paymentId: "p-1", paymentNo: "PN-1", amount: 100, customerName: "客户 A" }, ["u-1", "u-2"]);
    const r = await emit(prisma, ev);
    expect(r).toBe(2);
    expect(mockState.createManyCalls).toHaveLength(1);
    expect(mockState.createManyCalls[0]!.data).toHaveLength(2);
    expect(mockState.createManyCalls[0]!.data[0]!).toMatchObject({
      receiverUserId: "u-1",
      type: "PAYMENT_RECEIVED"
    });
    // 外部通道被 fire-and-forget 调用（测试中是同步 mock）
    expect(mockState.dispatchCalls).toHaveLength(1);
  });

  it("CUSTOMER_STATUS_SUGGEST 消息保留 suggest 字段", async () => {
    const ev = makeEvent("CUSTOMER_STATUS_SUGGEST", {
      customerId: "c-1",
      customerName: "客户 A",
      suggestedStatus: "LOST",
      suggestedStatusLabel: "已流失",
      reason: "90 天无跟进"
    }, ["u-1"]);
    await emit(prisma, ev);
    const data = mockState.createManyCalls[0]!.data;
    expect(data[0]!).toMatchObject({
      title: "建议将客户 客户 A 状态变更为 已流失",
      link: { kind: "customer", id: "c-1", suggest: "LOST" }
    });
  });

  it("CONTRACT_EXPIRING 消息包含 daysLeft", async () => {
    const ev = makeEvent("CONTRACT_EXPIRING", {
      contractId: "c-1",
      contractNo: "CT-2026-001",
      endDate: "2026-12-31",
      daysLeft: 7
    }, ["u-1"]);
    await emit(prisma, ev);
    const data = mockState.createManyCalls[0]!.data;
    expect(data[0]!).toMatchObject({
      title: "合同 CT-2026-001 将于 7 天后到期",
      link: { kind: "contract", id: "c-1" }
    });
  });
});

describe("buildMessage default case", () => {
  it("未处理事件类型应抛错", async () => {
    const ev = { type: "UNKNOWN_EVENT", payload: {}, receivers: ["u-1"] } as unknown as DomainEvent;
    await expect(emit(prisma, ev)).rejects.toThrow("[bus] unhandled event type");
  });
});
