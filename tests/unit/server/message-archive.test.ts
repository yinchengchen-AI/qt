// MessageArchive service + cron job 单元测试
//
// 覆盖:
//   - listArchivedMessages: ADMIN 通过,非 ADMIN 拒绝
//   - runMessageArchive: 找 readAt < cutoff 的已读消息 → 搬到 MessageArchive + 从 Message 删
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionUser } from "@/lib/session";

type Msg = {
  id: string;
  receiverUserId: string;
  type: string;
  title: string;
  content: string;
  link: unknown;
  entityKey: string | null;
  readAt: Date | null;
  createdAt: Date;
};
type Arch = Msg & { archivedAt: Date };

const mockState = vi.hoisted(() => ({
  messages: [] as Msg[],
  archives: [] as Array<Msg & { archivedAt?: Date }>
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    message: {
      findMany: vi.fn(async (args: { where?: { readAt?: { not?: null; lt?: Date } | null; receiverUserId?: string; id?: { in?: string[] } }; orderBy?: unknown; take?: number; select?: unknown }) => {
        let list = [...mockState.messages];
        const w = args.where ?? {};
        if (w.readAt && "not" in w.readAt && w.readAt.not === null && w.readAt.lt) {
          const cutoff = w.readAt.lt;
          list = list.filter((m) => m.readAt !== null && m.readAt < cutoff);
        }
        if (w.id && "in" in w.id) list = list.filter((m) => w.id!.in!.includes(m.id));
        if (args.orderBy) list = list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        if (args.take) list = list.slice(0, args.take);
        return list;
      }),
      deleteMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
        const ids = new Set(args.where.id.in);
        const before = mockState.messages.length;
        mockState.messages = mockState.messages.filter((m) => !ids.has(m.id));
        return { count: before - mockState.messages.length };
      })
    },
    messageArchive: {
      createMany: vi.fn(async (args: { data: Arch[]; skipDuplicates?: boolean }) => {
        const existing = new Set(mockState.archives.map((a) => a.id));
        const added: Arch[] = [];
        for (const a of args.data) {
          if (existing.has(a.id)) {
            if (args.skipDuplicates) continue;
          } else {
            added.push(a);
          }
        }
        mockState.archives.push(...added);
        return { count: added.length };
      }),
      findMany: vi.fn(async (args: { where?: { receiverUserId?: string; archivedAt?: { gte?: Date; lt?: Date } }; orderBy?: unknown; skip?: number; take?: number }) => {
        let list = [...mockState.archives].filter((a) => a.archivedAt);
        const w = args.where ?? {};
        if (w.receiverUserId) list = list.filter((a) => a.receiverUserId === w.receiverUserId);
        if (w.archivedAt) {
          if (w.archivedAt.gte) list = list.filter((a) => a.archivedAt! >= w.archivedAt!.gte!);
          if (w.archivedAt.lt) list = list.filter((a) => a.archivedAt! < w.archivedAt!.lt!);
        }
        if (args.orderBy) list = list.sort((a, b) => b.archivedAt!.getTime() - a.archivedAt!.getTime());
        if (args.skip) list = list.slice(args.skip);
        if (args.take) list = list.slice(0, args.take);
        return list;
      }),
      count: vi.fn(async (args: { where?: { receiverUserId?: string; archivedAt?: { gte?: Date; lt?: Date } } }) => {
        let list = [...mockState.archives].filter((a) => a.archivedAt);
        const w = args.where ?? {};
        if (w.receiverUserId) list = list.filter((a) => a.receiverUserId === w.receiverUserId);
        if (w.archivedAt) {
          if (w.archivedAt.gte) list = list.filter((a) => a.archivedAt! >= w.archivedAt!.gte!);
          if (w.archivedAt.lt) list = list.filter((a) => a.archivedAt! < w.archivedAt!.lt!);
        }
        return list.length;
      })
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      return fn({
        message: {
          findMany: (await import("@/lib/prisma")).prisma.message.findMany,
          deleteMany: (await import("@/lib/prisma")).prisma.message.deleteMany
        },
        messageArchive: {
          createMany: (await import("@/lib/prisma")).prisma.messageArchive.createMany
        }
      });
    })
  }
}));

import { listArchivedMessages } from "@/server/services/message";
import { runMessageArchive } from "@/server/jobs/message-archive";

const makeUser = (roleCode: SessionUser["roleCode"], id = "u-admin"): SessionUser => ({
  id,
  employeeNo: id,
  name: "Test",
  email: "test@qt.com",
  roleCode,
  permissions: []
});

const mkMsg = (over: Partial<Msg> & { archivedAt?: Date } = {}): Msg & { archivedAt?: Date } => ({
  id: over.id ?? "m-1",
  receiverUserId: over.receiverUserId ?? "u-1",
  type: over.type ?? "PAYMENT_RECEIVED",
  title: over.title ?? "t",
  content: over.content ?? "c",
  link: over.link ?? null,
  entityKey: over.entityKey ?? "PAYMENT_RECEIVED:1",
  readAt: over.readAt ?? null,
  createdAt: over.createdAt ?? new Date("2026-01-01"),
  archivedAt: over.archivedAt
});

beforeEach(() => {
  mockState.messages = [];
  mockState.archives = [];
});

describe("listArchivedMessages", () => {
  it("ADMIN 调用通过并返回归档列表", async () => {
    mockState.archives = [
      { ...mkMsg({ id: "a-1", archivedAt: new Date("2026-04-01") }) }
    ];
    const r = await listArchivedMessages(makeUser("ADMIN"), { page: 1, pageSize: 10 });
    expect(r.total).toBe(1);
    expect(r.list[0]?.id).toBe("a-1");
  });

  it("非 ADMIN 调用直接拒绝 (FORBIDDEN 403)", async () => {
    await expect(listArchivedMessages(makeUser("SALES"), { page: 1, pageSize: 10 }))
      .rejects.toMatchObject({ status: 403 });
  });

  it("按 month 过滤: YYYY-MM 范围生效", async () => {
    mockState.archives = [
      { ...mkMsg({ id: "mar", archivedAt: new Date("2026-03-15") }) },
      { ...mkMsg({ id: "apr", archivedAt: new Date("2026-04-15") }) }
    ];
    const r = await listArchivedMessages(makeUser("ADMIN"), { page: 1, pageSize: 10, month: "2026-04" });
    expect(r.total).toBe(1);
    expect(r.list[0]?.id).toBe("apr");
  });
});

describe("runMessageArchive", () => {
  it("90 天前的已读消息被搬到 MessageArchive, 主表已删", async () => {
    const now = new Date("2026-08-01");
    const old = new Date("2026-01-01");
    const recent = new Date("2026-07-15");
    mockState.messages = [
      mkMsg({ id: "old-1", readAt: old, createdAt: old }),       // 应归档
      mkMsg({ id: "old-2", readAt: old, createdAt: old }),       // 应归档
      mkMsg({ id: "recent", readAt: recent, createdAt: recent }), // 未达 90 天
      mkMsg({ id: "unread", readAt: null, createdAt: old })        // 未读
    ];
    const r = await runMessageArchive(now);
    expect(r.archived).toBe(2);
    expect(r.batch).toBe(2);
    // 主表剩 recent + unread
    expect(mockState.messages.map((m) => m.id).sort()).toEqual(["recent", "unread"]);
    // archive 表 + 2 行
    expect(mockState.archives).toHaveLength(2);
    expect(mockState.archives.map((a) => a.id).sort()).toEqual(["old-1", "old-2"]);
  });

  it("空集合直接返回 0, 不调 archive", async () => {
    const r = await runMessageArchive(new Date("2026-08-01"));
    expect(r.archived).toBe(0);
    expect(r.batch).toBe(0);
    expect(mockState.archives).toHaveLength(0);
  });
});
