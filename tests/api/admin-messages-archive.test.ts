// v0.24.0 admin messages-archive 路由回归 lock test
//
// 覆盖:
//   - GET /api/admin/messages-archive?mode=archive|recycle (admin only)
//   - POST /api/admin/messages-archive/[id]/restore body { mode }
//   - POST /api/admin/messages-archive/batch body { ids, mode, action }
//   - GET /api/admin/messages-archive/users (admin only)
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/session";

const sessionHolder = vi.hoisted(() => ({ actor: null as SessionUser | null }));

vi.mock("@/lib/session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/session")>();
  const { ApiError } = await import("@/lib/api");
  const { ERROR_CODES } = await import("@/types/errors");
  return {
    ...mod,
    requireSession: async (): Promise<SessionUser> => {
      if (!sessionHolder.actor) {
        throw new ApiError(ERROR_CODES.UNAUTHORIZED, "请先登录", 401);
      }
      return sessionHolder.actor;
    }
  };
});

const mockState = vi.hoisted(() => ({
  messages: new Map<string, { id: string; receiverUserId: string; type: string; title: string; content: string; deletedAt: Date | null; readAt: Date | null; link: unknown; entityKey: string | null; createdAt: Date }>(),
  archives: new Map<string, { id: string; receiverUserId: string; type: string; title: string; content: string; link: unknown; entityKey: string | null; readAt: Date | null; createdAt: Date; archivedAt: Date }>(),
  users: [] as Array<{ id: string; employeeNo: string; name: string }>,
  audits: [] as Array<Record<string, unknown>>
}));

function resetMockState() {
  mockState.messages.clear();
  mockState.archives.clear();
  mockState.users = [
    { id: "u-1", employeeNo: "0001", name: "Alice" },
    { id: "u-2", employeeNo: "0002", name: "Bob" }
  ];
  mockState.audits.length = 0;
}

function seedRecycledMessage(id: string, receiverUserId: string) {
  mockState.messages.set(id, {
    id, receiverUserId,
    type: "PAYMENT_RECEIVED", title: `t-${id}`, content: `c-${id}`,
    deletedAt: new Date(), readAt: new Date(),
    link: null, entityKey: null, createdAt: new Date()
  });
}

function seedArchive(id: string, receiverUserId: string) {
  mockState.archives.set(id, {
    id, receiverUserId,
    type: "CONTRACT_EXPIRING", title: `a-${id}`, content: `ac-${id}`,
    readAt: new Date(), link: null, entityKey: null,
    createdAt: new Date(), archivedAt: new Date()
  });
}

vi.mock("@/lib/prisma", () => {
  const prismaMock = {
    message: {
      findFirst: vi.fn(async (args: { where: { id?: string; receiverUserId?: string; deletedAt?: Date | null | { not: null } } }) => {
        const m = mockState.messages.get(args.where.id ?? "");
        if (!m) return null;
        if (args.where.receiverUserId && m.receiverUserId !== args.where.receiverUserId) return null;
        const da = args.where.deletedAt;
        if (da === null && m.deletedAt !== null) return null;
        if (da && typeof da === "object" && "not" in da && (da as { not: unknown }).not === null && m.deletedAt === null) return null;
        return { ...m };
      }),
      findMany: vi.fn(async (args: { where: { receiverUserId?: string; deletedAt?: Date | null | { not: null } }; skip?: number; take?: number }) => {
        let list = Array.from(mockState.messages.values());
        if (args.where.receiverUserId) list = list.filter((m) => m.receiverUserId === args.where.receiverUserId);
        const da = args.where.deletedAt;
        if (da && typeof da === "object" && "not" in da && (da as { not: unknown }).not === null) list = list.filter((m) => m.deletedAt !== null);
        list.sort((a, b) => (b.deletedAt?.getTime() ?? 0) - (a.deletedAt?.getTime() ?? 0));
        if (args.skip) list = list.slice(args.skip);
        if (args.take) list = list.slice(0, args.take);
        return list.map((m) => ({ ...m }));
      }),
      count: vi.fn(async (args: { where: { receiverUserId?: string; deletedAt?: Date | null | { not: null } } }) => {
        let list = Array.from(mockState.messages.values());
        if (args.where.receiverUserId) list = list.filter((m) => m.receiverUserId === args.where.receiverUserId);
        const da = args.where.deletedAt;
        if (da && typeof da === "object" && "not" in da && (da as { not: unknown }).not === null) list = list.filter((m) => m.deletedAt !== null);
        return list.length;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: { deletedAt?: Date | null } }) => {
        const m = mockState.messages.get(args.where.id);
        if (!m) throw new Error("not found");
        if (args.data.deletedAt !== undefined) m.deletedAt = args.data.deletedAt;
        return { ...m };
      }),
      updateMany: vi.fn(async (args: { where: { id: { in: string[] }; deletedAt?: { not: null } | null }; data: { deletedAt: Date | null } }) => {
        let count = 0;
        for (const id of args.where.id.in) {
          const m = mockState.messages.get(id);
          if (!m) continue;
          if (args.where.deletedAt && typeof args.where.deletedAt === "object" && "not" in args.where.deletedAt && args.where.deletedAt.not === null && m.deletedAt === null) continue;
          if (args.data.deletedAt !== undefined) m.deletedAt = args.data.deletedAt;
          count++;
        }
        return { count };
      }),
      deleteMany: vi.fn(async (args: { where: { id: { in: string[] }; deletedAt?: { not: null } | null } }) => {
        let count = 0;
        for (const id of args.where.id.in) {
          const m = mockState.messages.get(id);
          if (!m) continue;
          if (args.where.deletedAt && typeof args.where.deletedAt === "object" && "not" in args.where.deletedAt && args.where.deletedAt.not === null && m.deletedAt === null) continue;
          mockState.messages.delete(id);
          count++;
        }
        return { count };
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const m = mockState.messages.get(args.where.id);
        if (!m) throw new Error("not found");
        mockState.messages.delete(args.where.id);
        return { ...m };
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const id = `m-new-${Date.now()}-${Math.random()}`;
        const m = {
          id, receiverUserId: args.data.receiverUserId as string,
          type: args.data.type as string, title: args.data.title as string,
          content: args.data.content as string, deletedAt: null, readAt: null,
          link: args.data.link ?? null, entityKey: (args.data.entityKey as string | null) ?? null,
          createdAt: new Date()
        };
        mockState.messages.set(id, m);
        return { ...m };
      })
    },
    messageArchive: {
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        const m = mockState.archives.get(args.where.id);
        return m ? { ...m } : null;
      }),
      findMany: vi.fn(async (args: { where: { receiverUserId?: string }; skip?: number; take?: number }) => {
        let list = Array.from(mockState.archives.values());
        if (args.where.receiverUserId) list = list.filter((m) => m.receiverUserId === args.where.receiverUserId);
        list.sort((a, b) => b.archivedAt.getTime() - a.archivedAt.getTime());
        if (args.skip) list = list.slice(args.skip);
        if (args.take) list = list.slice(0, args.take);
        return list.map((m) => ({ ...m }));
      }),
      count: vi.fn(async (args: { where: { receiverUserId?: string } }) => {
        let list = Array.from(mockState.archives.values());
        if (args.where.receiverUserId) list = list.filter((m) => m.receiverUserId === args.where.receiverUserId);
        return list.length;
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        mockState.archives.delete(args.where.id);
        return { id: args.where.id };
      })
    },
    user: {
      findMany: vi.fn(async () => mockState.users.map((u) => ({ ...u })))
    },
    $transaction: vi.fn(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock))
  };
  return { prisma: prismaMock };
});

vi.mock("@/server/audit", () => ({
  audit: vi.fn(async (_tx: unknown, input: Record<string, unknown>) => {
    mockState.audits.push(input);
  })
}));

import { GET as archiveGET } from "@/app/api/admin/messages-archive/route";
import { POST as archiveIdRestorePOST } from "@/app/api/admin/messages-archive/[id]/restore/route";
import { POST as batchPOST } from "@/app/api/admin/messages-archive/batch/route";
import { GET as usersGET } from "@/app/api/admin/messages-archive/users/route";

const ADMIN: SessionUser = { id: "u-admin", employeeNo: "admin", name: "Admin", email: "a@t.local", roleCode: "ADMIN", permissions: [] };
const SALES: SessionUser = { id: "u-sales", employeeNo: "s", name: "Sales", email: "s@t.local", roleCode: "SALES", permissions: [] };

beforeEach(() => {
  resetMockState();
  sessionHolder.actor = ADMIN;
});

describe("GET /api/admin/messages-archive?mode=...", () => {
  it("默认 mode=archive, admin 可看全公司归档", async () => {
    seedArchive("a-1", "u-1");
    seedArchive("a-2", "u-2");
    const res = await archiveGET(new Request("http://localhost/api/admin/messages-archive", { method: "GET" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.list).toHaveLength(2);
    expect(body.data.mode).toBe("archive");
  });

  it("mode=recycle, 查的是 Message with deletedAt != null", async () => {
    seedRecycledMessage("m-1", "u-1");
    seedRecycledMessage("m-2", "u-2");
    mockState.messages.set("m-3", { // inbox, 不该返回
      id: "m-3", receiverUserId: "u-1",
      type: "PAYMENT_RECEIVED", title: "t-3", content: "c-3",
      deletedAt: null, readAt: null, link: null, entityKey: null,
      createdAt: new Date()
    });
    const res = await archiveGET(new Request("http://localhost/api/admin/messages-archive?mode=recycle", { method: "GET" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.list.map((r: { id: string }) => r.id).sort()).toEqual(["m-1", "m-2"]);
    expect(body.data.mode).toBe("recycle");
  });

  it("SALES 角色 → 403 (只有 admin 可访问)", async () => {
    sessionHolder.actor = SALES;
    const res = await archiveGET(new Request("http://localhost/api/admin/messages-archive", { method: "GET" }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/messages-archive/[id]/restore", () => {
  it("mode=archive → 把归档行挪到 inbox, 删归档行", async () => {
    seedArchive("a-1", "u-1");
    const beforeCount = mockState.messages.size;
    const res = await archiveIdRestorePOST(new Request("http://localhost/api/admin/messages-archive/a-1/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "archive" })
    }), { params: Promise.resolve({ id: "a-1" }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.code).toBe(0);
    // 归档行被删
    expect(mockState.archives.has("a-1")).toBe(false);
    // inbox 多了一行
    expect(mockState.messages.size).toBe(beforeCount + 1);
    // 审计: MESSAGE_ARCHIVE_RESTORE
    expect(mockState.audits.map((a) => a.action)).toContain("MESSAGE_ARCHIVE_RESTORE");
  });

  it("mode=recycle → 还原已软删的消息", async () => {
    seedRecycledMessage("m-1", "u-1");
    const res = await archiveIdRestorePOST(new Request("http://localhost/api/admin/messages-archive/m-1/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "recycle" })
    }), { params: Promise.resolve({ id: "m-1" }) });
    expect(res.status).toBe(200);
    expect(mockState.messages.get("m-1")!.deletedAt).toBeNull();
    expect(mockState.audits.map((a) => a.action)).toContain("MESSAGE_BATCH_RESTORE_ADMIN");
  });

  it("SALES 角色 → 403", async () => {
    sessionHolder.actor = SALES;
    seedRecycledMessage("m-1", "u-1");
    const res = await archiveIdRestorePOST(new Request("http://localhost/api/admin/messages-archive/m-1/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "recycle" })
    }), { params: Promise.resolve({ id: "m-1" }) });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/messages-archive/batch", () => {
  it("mode=recycle action=restore → 批量还原", async () => {
    seedRecycledMessage("m-1", "u-1");
    seedRecycledMessage("m-2", "u-2");
    const res = await batchPOST(new Request("http://localhost/api/admin/messages-archive/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m-1", "m-2"], mode: "recycle", action: "restore" })
    }));
    expect(res.status).toBe(200);
    expect(mockState.messages.get("m-1")!.deletedAt).toBeNull();
    expect(mockState.messages.get("m-2")!.deletedAt).toBeNull();
  });

  it("mode=recycle action=purge → 批量硬删", async () => {
    seedRecycledMessage("m-1", "u-1");
    seedRecycledMessage("m-2", "u-2");
    const res = await batchPOST(new Request("http://localhost/api/admin/messages-archive/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m-1", "m-2"], mode: "recycle", action: "purge" })
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.affected).toBe(2);
    expect(mockState.messages.has("m-1")).toBe(false);
    expect(mockState.messages.has("m-2")).toBe(false);
  });

  it("SALES 角色 → 403", async () => {
    sessionHolder.actor = SALES;
    const res = await batchPOST(new Request("http://localhost/api/admin/messages-archive/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m-1"], mode: "recycle", action: "purge" })
    }));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/messages-archive/users", () => {
  it("admin → 200 + 用户列表", async () => {
    const res = await usersGET(new Request("http://localhost/api/admin/messages-archive/users", { method: "GET" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.list).toHaveLength(2);
  });

  it("SALES 角色 → 403", async () => {
    sessionHolder.actor = SALES;
    const res = await usersGET(new Request("http://localhost/api/admin/messages-archive/users", { method: "GET" }));
    expect(res.status).toBe(403);
  });
});
