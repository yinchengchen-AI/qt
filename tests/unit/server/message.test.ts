// Message service 单元测试
//
// 覆盖:
//   - listMessages 分页、unread 过滤、unreadCount 返回
//   - markRead 幂等
//   - markAllRead 只更新未读
//   - deleteMessage 校验权限与所有权，并写审计日志
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionUser } from "@/lib/session";

const mockState = vi.hoisted(() => ({
  messages: [] as Array<{
    id: string;
    receiverUserId: string;
    type: string;
    title: string;
    content: string;
    readAt: Date | null;
    createdAt: Date;
    deletedAt: Date | null;
  }>,
  audits: [] as Array<Record<string, unknown>>
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: {
      findMany: vi.fn(async (args: { where?: { receiverUserId?: string; readAt?: null | { not: null }; deletedAt?: Date | null | { not: null }; skip?: number; take?: number } & Record<string, unknown>; skip?: number; take?: number }) => {
        let list = [...mockState.messages];
        const whereAny = args.where as Record<string, unknown> | undefined;
        if (whereAny?.receiverUserId) {
          list = list.filter((m) => m.receiverUserId === whereAny.receiverUserId);
        }
        if (whereAny?.readAt === null) {
          list = list.filter((m) => m.readAt === null);
        } else if (whereAny && typeof whereAny.readAt === "object" && whereAny.readAt !== null && "not" in (whereAny.readAt as object) && (whereAny.readAt as { not: unknown }).not === null) {
          list = list.filter((m) => m.readAt !== null);
        }
        if (whereAny?.deletedAt === null) {
          list = list.filter((m) => m.deletedAt === null);
        } else if (whereAny && typeof whereAny.deletedAt === "object" && whereAny.deletedAt !== null && "not" in (whereAny.deletedAt as object) && (whereAny.deletedAt as { not: unknown }).not === null) {
          list = list.filter((m) => m.deletedAt !== null);
        }
        if (args.skip) list = list.slice(args.skip);
        if (args.take) list = list.slice(0, args.take);
        return list.map((m) => ({ ...m }));
      }),
      count: vi.fn(async (args: { where?: { receiverUserId?: string; readAt?: null | { not: null }; deletedAt?: Date | null | { not: null } } & Record<string, unknown> }) => {
        let list = [...mockState.messages];
        const whereAny = args.where as Record<string, unknown> | undefined;
        if (whereAny?.receiverUserId) {
          list = list.filter((m) => m.receiverUserId === whereAny.receiverUserId);
        }
        if (whereAny?.readAt === null) {
          list = list.filter((m) => m.readAt === null);
        } else if (whereAny && typeof whereAny.readAt === "object" && whereAny.readAt !== null && "not" in (whereAny.readAt as object) && (whereAny.readAt as { not: unknown }).not === null) {
          list = list.filter((m) => m.readAt !== null);
        }
        if (whereAny?.deletedAt === null) {
          list = list.filter((m) => m.deletedAt === null);
        } else if (whereAny && typeof whereAny.deletedAt === "object" && whereAny.deletedAt !== null && "not" in (whereAny.deletedAt as object) && (whereAny.deletedAt as { not: unknown }).not === null) {
          list = list.filter((m) => m.deletedAt !== null);
        }
        return list.length;
      }),
      findFirst: vi.fn(async (args: { where: { id?: string; receiverUserId?: string; deletedAt?: Date | null | { not: null } } & Record<string, unknown> }) => {
        return (
          mockState.messages.find((m) => {
            if (args.where.id && m.id !== args.where.id) return false;
            if (args.where.receiverUserId && m.receiverUserId !== args.where.receiverUserId) return false;
            const da = args.where.deletedAt;
            if (da === null && m.deletedAt !== null) return false;
            if (da && typeof da === "object" && "not" in da && (da as { not: unknown }).not === null && m.deletedAt === null) return false;
            return true;
          }) ?? null
        );
      }),
      update: vi.fn(async (args: { where: { id: string }; data: { readAt?: Date; deletedAt?: Date | null } }) => {
        const m = mockState.messages.find((x) => x.id === args.where.id);
        if (!m) throw new Error("not found");
        if (args.data.readAt !== undefined) m.readAt = args.data.readAt;
        if (args.data.deletedAt !== undefined) m.deletedAt = args.data.deletedAt;
        return { ...m };
      }),
      updateMany: vi.fn(async (args: { where: { receiverUserId?: string; readAt?: null | { not: null }; id?: { in?: string[] }; deletedAt?: Date | null | { not: null } } & Record<string, unknown>; data: { readAt?: Date; deletedAt?: Date | null } }) => {
        let updated = 0;
        const idIn = args.where.id?.in;
        for (const m of mockState.messages) {
          if (idIn && !idIn.includes(m.id)) continue;
          if (args.where.receiverUserId && m.receiverUserId !== args.where.receiverUserId) continue;
          if (args.where.readAt === null && m.readAt !== null) continue;
          if (args.where.readAt && typeof args.where.readAt === "object" && "not" in args.where.readAt && (args.where.readAt as { not: unknown }).not === null && m.readAt === null) continue;
          if (args.where.deletedAt === null && m.deletedAt !== null) continue;
          if (args.where.deletedAt && typeof args.where.deletedAt === "object" && "not" in args.where.deletedAt && (args.where.deletedAt as { not: unknown }).not === null && m.deletedAt === null) continue;
          if (args.data.readAt) m.readAt = args.data.readAt;
          if (args.data.deletedAt !== undefined) m.deletedAt = args.data.deletedAt;
          updated++;
        }
        return { count: updated };
      }),
      deleteMany: vi.fn(async (args: { where: { receiverUserId?: string; readAt?: { not?: null } | null } }) => {
        let removed = 0;
        for (let i = mockState.messages.length - 1; i >= 0; i--) {
          const m = mockState.messages[i]!;
          if (args.where.receiverUserId && m.receiverUserId !== args.where.receiverUserId) continue;
          const ra = args.where.readAt;
          if (ra === null && m.readAt !== null) continue;                 // readAt IS null → 只删 unread (本测试不会出现)
          if (ra && typeof ra === "object" && "not" in ra && ra.not === null && m.readAt === null) continue;  // readAt IS NOT null → 只删已读
          mockState.messages.splice(i, 1);
          removed++;
        }
        return { count: removed };
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const idx = mockState.messages.findIndex((x) => x.id === args.where.id);
        if (idx === -1) throw new Error("not found");
        const removed = mockState.messages.splice(idx, 1)[0];
        return removed;
      })
    }
  }
}));

vi.mock("@/server/audit", () => ({
  audit: vi.fn(async (_tx: unknown, input: Record<string, unknown>) => {
    mockState.audits.push(input);
  })
}));

import {
  listMessages,
  markRead,
  markAllRead,
  deleteMessage,
  countUnreadMessages,
  clearReadMessages
} from "@/server/services/message";

const makeUser = (roleCode: SessionUser["roleCode"], id = "u-1"): SessionUser => ({
  id,
  employeeNo: id,
  name: "Test",
  email: "test@qt.com",
  roleCode,
  permissions: []
});

beforeEach(() => {
  mockState.messages = [];
  mockState.audits = [];
});

describe("listMessages", () => {
  it("返回分页列表与未读数", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date(), deletedAt: null },
      { id: "m-2", receiverUserId: "u-1", type: "CONTRACT_EXPIRING", title: "t2", content: "c2", readAt: new Date(), createdAt: new Date(), deletedAt: null },
      { id: "m-3", receiverUserId: "u-2", type: "PAYMENT_RECEIVED", title: "t3", content: "c3", readAt: null, createdAt: new Date(), deletedAt: null }
    ];
    const r = await listMessages(makeUser("SALES"), { page: 1, pageSize: 10 });
    expect(r.list).toHaveLength(2);
    expect(r.total).toBe(2);
    expect(r.unreadCount).toBe(1);
  });

  it("unread=true 只返回未读", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date(), deletedAt: null },
      { id: "m-2", receiverUserId: "u-1", type: "CONTRACT_EXPIRING", title: "t2", content: "c2", readAt: new Date(), createdAt: new Date(), deletedAt: null }
    ];
    const r = await listMessages(makeUser("SALES"), { page: 1, pageSize: 10, unread: true });
    expect(r.list).toHaveLength(1);
    expect(r.list[0]!.id).toBe("m-1");
  });
});

describe("countUnreadMessages", () => {
  it("只统计当前用户的未读数", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date(), deletedAt: null },
      { id: "m-2", receiverUserId: "u-1", type: "CONTRACT_EXPIRING", title: "t2", content: "c2", readAt: new Date(), createdAt: new Date(), deletedAt: null },
      { id: "m-3", receiverUserId: "u-2", type: "PAYMENT_RECEIVED", title: "t3", content: "c3", readAt: null, createdAt: new Date(), deletedAt: null }
    ];
    const r = await countUnreadMessages(makeUser("SALES", "u-1"));
    expect(r.unreadCount).toBe(1);
  });
});

describe("markRead", () => {
  it("首次标记写入 readAt，重复调用不覆盖", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date(), deletedAt: null }
    ];
    const first = await markRead(makeUser("SALES"), "m-1");
    expect(first.readAt).not.toBeNull();
    const originalReadAt = first.readAt;
    await new Promise((res) => setTimeout(res, 5));
    const second = await markRead(makeUser("SALES"), "m-1");
    expect(second.readAt).toEqual(originalReadAt);
  });

  it("不能标记别人的消息", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-2", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date(), deletedAt: null }
    ];
    await expect(markRead(makeUser("SALES", "u-1"), "m-1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("markAllRead", () => {
  it("只更新当前用户的未读消息", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date(), deletedAt: null },
      { id: "m-2", receiverUserId: "u-1", type: "CONTRACT_EXPIRING", title: "t2", content: "c2", readAt: null, createdAt: new Date(), deletedAt: null },
      { id: "m-3", receiverUserId: "u-2", type: "PAYMENT_RECEIVED", title: "t3", content: "c3", readAt: null, createdAt: new Date(), deletedAt: null },
      { id: "m-4", receiverUserId: "u-1", type: "CONTRACT_EXPIRED_UNPAID", title: "t4", content: "c4", readAt: new Date(), createdAt: new Date(), deletedAt: null }
    ];
    const r = await markAllRead(makeUser("SALES", "u-1"));
    expect(r.updated).toBe(2);
    expect(mockState.messages.filter((m) => m.receiverUserId === "u-1" && m.readAt === null)).toHaveLength(0);
    expect(mockState.messages.find((m) => m.id === "m-3")!.readAt).toBeNull();
  });

  it("有未读被标记时写 MESSAGE_MARK_ALL_READ 审计", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date(), deletedAt: null },
      { id: "m-2", receiverUserId: "u-1", type: "CONTRACT_EXPIRING", title: "t2", content: "c2", readAt: null, createdAt: new Date(), deletedAt: null }
    ];
    const r = await markAllRead(makeUser("SALES", "u-1"));
    expect(r.updated).toBe(2);
    expect(mockState.audits).toHaveLength(1);
    expect(mockState.audits[0]).toMatchObject({
      action: "MESSAGE_MARK_ALL_READ",
      entity: "Message",
      entityId: "u-1",
      after: { count: 2 }
    });
  });

  it("没有未读时不写审计 (避免噪音)", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: new Date(), createdAt: new Date(), deletedAt: null }
    ];
    const r = await markAllRead(makeUser("SALES", "u-1"));
    expect(r.updated).toBe(0);
    expect(mockState.audits).toHaveLength(0);
  });
});

describe("deleteMessage", () => {
  it("v0.24.0 软删: 自己的消息, deletedAt 被设置, MESSAGE_RECYCLE 审计", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date(), deletedAt: null }
    ];
    await deleteMessage(makeUser("SALES", "u-1"), "m-1");
    // 行还在, 只是 deletedAt 被设
    expect(mockState.messages).toHaveLength(1);
    expect(mockState.messages[0]!.deletedAt).not.toBeNull();
    expect(mockState.audits).toHaveLength(1);
    expect(mockState.audits[0]).toMatchObject({
      action: "MESSAGE_RECYCLE",
      entity: "Message",
      entityId: "m-1"
    });
  });

  it("不能删别人的消息", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-2", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date(), deletedAt: null }
    ];
    await expect(deleteMessage(makeUser("SALES", "u-1"), "m-1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("clearReadMessages", () => {
  it("只回收当前用户的已读消息, 未读的不动 (v0.24.0 改为软删)", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date(), deletedAt: null },
      { id: "m-2", receiverUserId: "u-1", type: "CONTRACT_EXPIRING", title: "t2", content: "c2", readAt: new Date(), createdAt: new Date(), deletedAt: null },
      { id: "m-3", receiverUserId: "u-1", type: "CONTRACT_EXPIRED_UNPAID", title: "t3", content: "c3", readAt: new Date(), createdAt: new Date(), deletedAt: null },
      { id: "m-4", receiverUserId: "u-2", type: "PAYMENT_RECEIVED", title: "t4", content: "c4", readAt: new Date(), createdAt: new Date(), deletedAt: null }
    ];
    const r = await clearReadMessages(makeUser("SALES", "u-1"));
    expect(r.recycled).toBe(2);
    // 软删: 行还在, 但 deletedAt 被设置
    expect(mockState.messages).toHaveLength(4);
    const m1 = mockState.messages.find((m) => m.id === "m-1")!;
    const m2 = mockState.messages.find((m) => m.id === "m-2")!;
    const m3 = mockState.messages.find((m) => m.id === "m-3")!;
    const m4 = mockState.messages.find((m) => m.id === "m-4")!;
    expect(m1.deletedAt).toBeNull();  // unread, 不动
    expect(m2.deletedAt).not.toBeNull();
    expect(m3.deletedAt).not.toBeNull();
    expect(m4.deletedAt).toBeNull();  // 别人的, 不动
  });

  it("回收有痕迹时写 MESSAGE_CLEAR_READ 审计 (after.recycled)", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: new Date(), createdAt: new Date(), deletedAt: null }
    ];
    await clearReadMessages(makeUser("SALES", "u-1"));
    expect(mockState.audits).toHaveLength(1);
    expect(mockState.audits[0]).toMatchObject({
      action: "MESSAGE_CLEAR_READ",
      entity: "Message",
      entityId: "u-1",
      after: { recycled: 1 }
    });
  });

  it("没有已读时不写审计 (避免噪音)", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date(), deletedAt: null }
    ];
    const r = await clearReadMessages(makeUser("SALES", "u-1"));
    expect(r.recycled).toBe(0);
    expect(mockState.audits).toHaveLength(0);
  });
});

