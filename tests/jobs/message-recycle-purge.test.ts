// v0.24.0 消息回收站清理 job 测试
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  messages: [] as Array<{ id: string; type: string; receiverUserId: string; deletedAt: Date | null }>,
  deleted: [] as Array<{ id: string }>
}));

function resetMockState() {
  mockState.messages.length = 0;
  mockState.deleted.length = 0;
}

function seedMessage(id: string, opts: { deletedAt: Date | null; type?: string; receiverUserId?: string }) {
  mockState.messages.push({
    id,
    type: opts.type ?? "PAYMENT_RECEIVED",
    receiverUserId: opts.receiverUserId ?? "u-1",
    deletedAt: opts.deletedAt
  });
}

vi.mock("@/lib/prisma", () => {
  const txClient = {
    message: {
      deleteMany: vi.fn(async (args: { where: { id: { in: string[] } } }) => {
        const ids = args.where.id.in;
        let count = 0;
        for (let i = mockState.messages.length - 1; i >= 0; i--) {
          if (ids.includes(mockState.messages[i]!.id)) {
            mockState.deleted.push({ id: mockState.messages[i]!.id });
            mockState.messages.splice(i, 1);
            count++;
          }
        }
        return { count };
      })
    }
  };
  return {
    prisma: {
      message: {
        findMany: vi.fn(async (args: { where: { deletedAt: { not: null; lt: Date } }; take?: number }) => {
          const cutoff = args.where.deletedAt.lt;
          let list = mockState.messages.filter((m) => m.deletedAt !== null && m.deletedAt < cutoff);
          list.sort((a, b) => (a.deletedAt!.getTime() - b.deletedAt!.getTime()));
          if (args.take) list = list.slice(0, args.take);
          return list;
        }),
        deleteMany: txClient.message.deleteMany
      },
      $transaction: vi.fn(async (fn: (tx: typeof txClient) => Promise<unknown>) => fn(txClient))
    }
  };
});

import { runMessageRecyclePurge } from "@/server/jobs/message-recycle-purge";

beforeEach(() => resetMockState());

describe("runMessageRecyclePurge v0.24.0", () => {
  it("没有候选时返回全 0", async () => {
    const r = await runMessageRecyclePurge(new Date("2026-10-04T00:00:00Z"));
    expect(r.purged).toBe(0);
    expect(r.batch).toBe(0);
    expect(r.afterDays).toBe(30);
  });

  it("deletedAt = null 的 inbox 消息不会被清", async () => {
    seedMessage("m-1", { deletedAt: null });
    const r = await runMessageRecyclePurge(new Date("2026-10-04T00:00:00Z"));
    expect(r.purged).toBe(0);
    expect(mockState.messages).toHaveLength(1);
  });

  it("deletedAt < cutoff 的会被清 (> 30 天)", async () => {
    seedMessage("m-1", { deletedAt: new Date("2026-08-01T00:00:00Z") });
    seedMessage("m-2", { deletedAt: new Date("2026-09-15T00:00:00Z") });
    seedMessage("m-3", { deletedAt: new Date("2026-09-03T00:00:00Z") });
    const r = await runMessageRecyclePurge(new Date("2026-10-04T00:00:00Z"));
    expect(r.purged).toBe(2);
    expect(r.batch).toBe(2);
    expect(mockState.messages.map((m) => m.id).sort()).toEqual(["m-2"]);
    expect(mockState.deleted.map((d) => d.id).sort()).toEqual(["m-1", "m-3"]);
  });

  it("边界: 30 天 (cutoff 处) 不算, 31 天算", async () => {
    const now = new Date("2026-10-04T00:00:00Z");
    seedMessage("m-1", { deletedAt: new Date("2026-09-03T00:00:00Z") });  // 31 天
    seedMessage("m-2", { deletedAt: new Date("2026-09-04T00:00:00Z") });  // 30 天
    const r = await runMessageRecyclePurge(now);
    expect(r.purged).toBe(1);
    expect(mockState.messages.map((m) => m.id)).toEqual(["m-2"]);
  });
});
