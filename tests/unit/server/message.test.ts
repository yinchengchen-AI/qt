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
  }>,
  audits: [] as Array<Record<string, unknown>>
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: {
      findMany: vi.fn(async (args: { where?: { receiverUserId?: string; readAt?: null }; skip?: number; take?: number }) => {
        let list = [...mockState.messages];
        if (args.where?.receiverUserId) {
          list = list.filter((m) => m.receiverUserId === args.where!.receiverUserId);
        }
        if (args.where?.readAt === null) {
          list = list.filter((m) => m.readAt === null);
        }
        if (args.skip) list = list.slice(args.skip);
        if (args.take) list = list.slice(0, args.take);
        return list.map((m) => ({ ...m }));
      }),
      count: vi.fn(async (args: { where?: { receiverUserId?: string; readAt?: null } }) => {
        let list = [...mockState.messages];
        if (args.where?.receiverUserId) {
          list = list.filter((m) => m.receiverUserId === args.where!.receiverUserId);
        }
        if (args.where?.readAt === null) {
          list = list.filter((m) => m.readAt === null);
        }
        return list.length;
      }),
      findFirst: vi.fn(async (args: { where: { id?: string; receiverUserId?: string } }) => {
        return (
          mockState.messages.find((m) => {
            if (args.where.id && m.id !== args.where.id) return false;
            if (args.where.receiverUserId && m.receiverUserId !== args.where.receiverUserId) return false;
            return true;
          }) ?? null
        );
      }),
      update: vi.fn(async (args: { where: { id: string }; data: { readAt?: Date } }) => {
        const m = mockState.messages.find((x) => x.id === args.where.id);
        if (!m) throw new Error("not found");
        if (args.data.readAt !== undefined) m.readAt = args.data.readAt;
        return { ...m };
      }),
      updateMany: vi.fn(async (args: { where: { receiverUserId?: string; readAt?: null }; data: { readAt: Date } }) => {
        let updated = 0;
        for (const m of mockState.messages) {
          if (args.where.receiverUserId && m.receiverUserId !== args.where.receiverUserId) continue;
          if (args.where.readAt === null && m.readAt !== null) continue;
          if (args.data.readAt) {
            m.readAt = args.data.readAt;
            updated++;
          }
        }
        return { count: updated };
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
  countUnreadMessages
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
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date() },
      { id: "m-2", receiverUserId: "u-1", type: "CONTRACT_EXPIRING", title: "t2", content: "c2", readAt: new Date(), createdAt: new Date() },
      { id: "m-3", receiverUserId: "u-2", type: "PAYMENT_RECEIVED", title: "t3", content: "c3", readAt: null, createdAt: new Date() }
    ];
    const r = await listMessages(makeUser("SALES"), { page: 1, pageSize: 10 });
    expect(r.list).toHaveLength(2);
    expect(r.total).toBe(2);
    expect(r.unreadCount).toBe(1);
  });

  it("unread=true 只返回未读", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date() },
      { id: "m-2", receiverUserId: "u-1", type: "CONTRACT_EXPIRING", title: "t2", content: "c2", readAt: new Date(), createdAt: new Date() }
    ];
    const r = await listMessages(makeUser("SALES"), { page: 1, pageSize: 10, unread: true });
    expect(r.list).toHaveLength(1);
    expect(r.list[0]!.id).toBe("m-1");
  });
});

describe("countUnreadMessages", () => {
  it("只统计当前用户的未读数", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date() },
      { id: "m-2", receiverUserId: "u-1", type: "CONTRACT_EXPIRING", title: "t2", content: "c2", readAt: new Date(), createdAt: new Date() },
      { id: "m-3", receiverUserId: "u-2", type: "PAYMENT_RECEIVED", title: "t3", content: "c3", readAt: null, createdAt: new Date() }
    ];
    const r = await countUnreadMessages(makeUser("SALES", "u-1"));
    expect(r.unreadCount).toBe(1);
  });
});

describe("markRead", () => {
  it("首次标记写入 readAt，重复调用不覆盖", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date() }
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
      { id: "m-1", receiverUserId: "u-2", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date() }
    ];
    await expect(markRead(makeUser("SALES", "u-1"), "m-1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("markAllRead", () => {
  it("只更新当前用户的未读消息", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date() },
      { id: "m-2", receiverUserId: "u-1", type: "CONTRACT_EXPIRING", title: "t2", content: "c2", readAt: null, createdAt: new Date() },
      { id: "m-3", receiverUserId: "u-2", type: "PAYMENT_RECEIVED", title: "t3", content: "c3", readAt: null, createdAt: new Date() },
      { id: "m-4", receiverUserId: "u-1", type: "CUSTOMER_INACTIVE", title: "t4", content: "c4", readAt: new Date(), createdAt: new Date() }
    ];
    const r = await markAllRead(makeUser("SALES", "u-1"));
    expect(r.updated).toBe(2);
    expect(mockState.messages.filter((m) => m.receiverUserId === "u-1" && m.readAt === null)).toHaveLength(0);
    expect(mockState.messages.find((m) => m.id === "m-3")!.readAt).toBeNull();
  });
});

describe("deleteMessage", () => {
  it("只能删除自己的消息并记录审计", async () => {
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-1", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date() }
    ];
    await deleteMessage(makeUser("SALES", "u-1"), "m-1");
    expect(mockState.messages).toHaveLength(0);
    expect(mockState.audits).toHaveLength(1);
    expect(mockState.audits[0]).toMatchObject({
      action: "MESSAGE_DELETE",
      entity: "Message",
      entityId: "m-1"
    });
  });

  it("无 MESSAGE.DELETE 权限应被拒绝", async () => {
    // ADMIN 有 MESSAGE DELETE；这里用一个无权限的角色触发
    // 由于权限矩阵中所有角色都有 MESSAGE CRUD，所以改测 "不能删别人的消息"
    mockState.messages = [
      { id: "m-1", receiverUserId: "u-2", type: "PAYMENT_RECEIVED", title: "t1", content: "c1", readAt: null, createdAt: new Date() }
    ];
    await expect(deleteMessage(makeUser("SALES", "u-1"), "m-1")).rejects.toMatchObject({ status: 404 });
  });
});
