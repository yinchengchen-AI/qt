// 领域事件总线单元测试
//
// 覆盖:
//   - emit 一次性 createMany 写入消息
//   - buildMessage 各分支 title/content/link 正确
//   - link 额外字段（如 suggest）透传
//   - 未处理事件类型抛错
import { describe, it, expect, beforeEach, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  createManyCalls: [] as Array<{ data: Array<Record<string, unknown>> }>
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
import { emit, type DomainEvent } from "@/server/events/bus";

beforeEach(() => {
  mockState.createManyCalls = [];
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

  it("createMany 批量写入 inbox 消息", async () => {
    const ev = makeEvent("PAYMENT_RECEIVED", { paymentId: "p-1", paymentNo: "PN-1", amount: 100, customerName: "客户 A" }, ["u-1", "u-2"]);
    const r = await emit(prisma, ev);
    expect(r).toBe(2);
    expect(mockState.createManyCalls).toHaveLength(1);
    expect(mockState.createManyCalls[0]!.data).toHaveLength(2);
    expect(mockState.createManyCalls[0]!.data[0]!).toMatchObject({
      receiverUserId: "u-1",
      type: "PAYMENT_RECEIVED"
    });
  });

  it("CUSTOMER_STATUS_SUGGEST (deprecated) 走 default fallback 渲染为历史消息", async () => {
    // v0.5.0 起客户状态机下线, CUSTOMER_STATUS_SUGGEST 不再 emit; 但 enum 仍保留值,
    // 历史 row / 漏改代码会落到 bus default 分支, 渲染为占位提示
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
      title: "历史消息 (CUSTOMER_STATUS_SUGGEST)",
      content: "该消息类型已下线, 详情请联系管理员"
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

describe("buildMessage default case (历史消息 fallback)", () => {
  it("未处理事件类型不再抛错, 渲染为占位提示", async () => {
    // 历史上 assertNever 抛错, 但 v0.5.0 后 PG Message 表可能含历史未知 type 的 row,
    // 渲染时不能让一个陌生 type 把整页渲染崩掉; 改走 fallback
    const ev = { type: "UNKNOWN_EVENT", payload: {}, receivers: ["u-1"] } as unknown as DomainEvent;
    const r = await emit(prisma, ev);
    expect(r).toBe(1);
    const data = mockState.createManyCalls[0]!.data;
    expect(data[0]!).toMatchObject({
      title: "历史消息 (UNKNOWN_EVENT)",
      content: "该消息类型已下线, 详情请联系管理员"
    });
  });
});
