// v0.24.0 消息回收站路由回归 lock test
//
// 覆盖:
//   - DELETE /api/messages/[id] → 软删 (deletedAt = now), 不删行
//   - POST /api/messages/[id]/restore → owner 恢复
//   - POST /api/messages/[id]/purge → owner 硬删
//   - GET /api/messages/recycle → 列出自己已软删
//   - GET /api/messages/archive → 列出自己的归档
//   - POST /api/messages/batch action: "restore" | "purge"
//   - 非 owner 操作 404/403
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
  // 模拟 DB: id -> { receiverUserId, deletedAt, readAt }
  messages: new Map<string, { id: string; receiverUserId: string; deletedAt: Date | null; readAt: Date | null; type: string; title: string; content: string; link: unknown; entityKey: string | null; createdAt: Date }>(),
  archives: new Map<string, { id: string; receiverUserId: string; type: string; title: string; content: string; link: unknown; entityKey: string | null; createdAt: Date; archivedAt: Date }>(),
  audits: [] as Array<Record<string, unknown>>
}));

function resetMockState() {
  mockState.messages.clear();
  mockState.archives.clear();
  mockState.audits.length = 0;
}

function seedMessage(id: string, receiverUserId: string, opts: Partial<{ deletedAt: Date | null; readAt: Date | null; type: string; title: string; content: string }> = {}) {
  mockState.messages.set(id, {
    id,
    receiverUserId,
    deletedAt: opts.deletedAt ?? null,
    readAt: opts.readAt ?? null,
    type: opts.type ?? "PAYMENT_RECEIVED",
    title: opts.title ?? `t-${id}`,
    content: opts.content ?? `c-${id}`,
    link: null,
    entityKey: null,
    createdAt: new Date()
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
      update: vi.fn(async (args: { where: { id: string }; data: { deletedAt?: Date | null; readAt?: Date } }) => {
        const m = mockState.messages.get(args.where.id);
        if (!m) throw new Error("not found");
        if (args.data.deletedAt !== undefined) m.deletedAt = args.data.deletedAt;
        if (args.data.readAt !== undefined) m.readAt = args.data.readAt;
        return { ...m };
      }),
      updateMany: vi.fn(async (args: { where: { id: { in: string[] }; receiverUserId?: string; deletedAt?: { not: null } | null }; data: { deletedAt: Date | null } }) => {
        let count = 0;
        for (const id of args.where.id.in) {
          const m = mockState.messages.get(id);
          if (!m) continue;
          if (args.where.receiverUserId && m.receiverUserId !== args.where.receiverUserId) continue;
          if (args.where.deletedAt === null && m.deletedAt !== null) continue;
          if (args.where.deletedAt && typeof args.where.deletedAt === "object" && "not" in args.where.deletedAt && args.where.deletedAt.not === null && m.deletedAt === null) continue;
          if (args.data.deletedAt !== undefined) m.deletedAt = args.data.deletedAt;
          count++;
        }
        return { count };
      }),
      deleteMany: vi.fn(async (args: { where: { id: { in: string[] }; receiverUserId?: string; deletedAt?: { not: null } | null } }) => {
        let count = 0;
        for (const id of args.where.id.in) {
          const m = mockState.messages.get(id);
          if (!m) continue;
          if (args.where.receiverUserId && m.receiverUserId !== args.where.receiverUserId) continue;
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
          id,
          receiverUserId: args.data.receiverUserId as string,
          deletedAt: null,
          readAt: null,
          type: args.data.type as string,
          title: args.data.title as string,
          content: args.data.content as string,
          link: args.data.link ?? null,
          entityKey: (args.data.entityKey as string | null) ?? null,
          createdAt: new Date()
        };
        mockState.messages.set(id, m);
        return { ...m };
      }),
      findMany: vi.fn(async (args: { where: { receiverUserId?: string; deletedAt?: Date | null | { not: null } }; skip?: number; take?: number }) => {
        let list = Array.from(mockState.messages.values());
        if (args.where.receiverUserId) list = list.filter((m) => m.receiverUserId === args.where.receiverUserId);
        const da = args.where.deletedAt;
        if (da === null) list = list.filter((m) => m.deletedAt === null);
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
        if (da === null) list = list.filter((m) => m.deletedAt === null);
        if (da && typeof da === "object" && "not" in da && (da as { not: unknown }).not === null) list = list.filter((m) => m.deletedAt !== null);
        return list.length;
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
        return { ...mockState.archives.get(args.where.id) };
      })
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

import { DELETE as msgDELETE } from "@/app/api/messages/[id]/route";
import { POST as restorePOST } from "@/app/api/messages/[id]/restore/route";
import { POST as purgePOST } from "@/app/api/messages/[id]/purge/route";
import { GET as recycleGET } from "@/app/api/messages/recycle/route";
import { GET as archiveGET } from "@/app/api/messages/archive/route";
import { POST as batchPOST } from "@/app/api/messages/batch/route";
import { POST as archiveRestorePOST } from "@/app/api/messages/archive/[id]/restore/route";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

const OWNER: SessionUser = { id: "u-owner", employeeNo: "owner", name: "Owner", email: "o@t.local", roleCode: "SALES", permissions: [] };
const OTHER: SessionUser = { id: "u-other", employeeNo: "other", name: "Other", email: "x@t.local", roleCode: "SALES", permissions: [] };

beforeEach(() => {
  resetMockState();
  sessionHolder.actor = OWNER;
});

describe("DELETE /api/messages/[id] v0.24.0 软删", () => {
  it("自己 inbox 的消息 → 软删 (deletedAt 设值, 行还在)", async () => {
    seedMessage("m-1", OWNER.id);
    const res = await msgDELETE(new Request("http://localhost/api/messages/m-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "m-1" })
    });
    expect(res.status).toBe(200);
    const m = mockState.messages.get("m-1")!;
    expect(m.deletedAt).not.toBeNull();
    // 审计: MESSAGE_RECYCLE (不是 MESSAGE_DELETE)
    const action = mockState.audits.map((a) => a.action);
    expect(action).toContain("MESSAGE_RECYCLE");
    expect(action).not.toContain("MESSAGE_DELETE");
  });

  it("别人的消息 → 404", async () => {
    seedMessage("m-1", OTHER.id);
    const res = await msgDELETE(new Request("http://localhost/api/messages/m-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "m-1" })
    });
    expect(res.status).toBe(404);
  });

  it("已软删的再删 → 404 (不能重复 recycle)", async () => {
    seedMessage("m-1", OWNER.id, { deletedAt: new Date() });
    const res = await msgDELETE(new Request("http://localhost/api/messages/m-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "m-1" })
    });
    expect(res.status).toBe(404);
  });

  it("未登录 → 401", async () => {
    sessionHolder.actor = null;
    seedMessage("m-1", OWNER.id);
    const res = await msgDELETE(new Request("http://localhost/api/messages/m-1", { method: "DELETE" }), {
      params: Promise.resolve({ id: "m-1" })
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /api/messages/[id]/restore v0.24.0", () => {
  it("自己已软删的 → 恢复 (deletedAt = null)", async () => {
    seedMessage("m-1", OWNER.id, { deletedAt: new Date() });
    const res = await restorePOST(new Request("http://localhost/api/messages/m-1/restore", { method: "POST" }), {
      params: Promise.resolve({ id: "m-1" })
    });
    expect(res.status).toBe(200);
    expect(mockState.messages.get("m-1")!.deletedAt).toBeNull();
    expect(mockState.audits.map((a) => a.action)).toContain("MESSAGE_RESTORE");
  });

  it("不在回收站的 (deletedAt = null) → 404", async () => {
    seedMessage("m-1", OWNER.id);
    const res = await restorePOST(new Request("http://localhost/api/messages/m-1/restore", { method: "POST" }), {
      params: Promise.resolve({ id: "m-1" })
    });
    expect(res.status).toBe(404);
  });

  it("别人的已软删 → 404 (不能越权)", async () => {
    seedMessage("m-1", OTHER.id, { deletedAt: new Date() });
    const res = await restorePOST(new Request("http://localhost/api/messages/m-1/restore", { method: "POST" }), {
      params: Promise.resolve({ id: "m-1" })
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/messages/[id]/purge v0.24.0 硬删", () => {
  it("自己已软删的 → 真正从 DB 删除", async () => {
    seedMessage("m-1", OWNER.id, { deletedAt: new Date() });
    const res = await purgePOST(new Request("http://localhost/api/messages/m-1/purge", { method: "POST" }), {
      params: Promise.resolve({ id: "m-1" })
    });
    expect(res.status).toBe(200);
    expect(mockState.messages.has("m-1")).toBe(false);
    expect(mockState.audits.map((a) => a.action)).toContain("MESSAGE_PURGE");
  });

  it("不在回收站的 (deletedAt = null) → 404", async () => {
    seedMessage("m-1", OWNER.id);
    const res = await purgePOST(new Request("http://localhost/api/messages/m-1/purge", { method: "POST" }), {
      params: Promise.resolve({ id: "m-1" })
    });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/messages/recycle v0.24.0", () => {
  it("只列自己已软删的消息 (排除 inbox)", async () => {
    seedMessage("m-1", OWNER.id, { deletedAt: new Date() });
    seedMessage("m-2", OWNER.id, { deletedAt: new Date() });
    seedMessage("m-3", OWNER.id); // inbox, 不该返回
    seedMessage("m-4", OTHER.id, { deletedAt: new Date() }); // 别人的, 不该返回
    const res = await recycleGET(new Request("http://localhost/api/messages/recycle", { method: "GET" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.list.map((r: { id: string }) => r.id).sort()).toEqual(["m-1", "m-2"]);
    expect(body.data.total).toBe(2);
  });
});

describe("GET /api/messages/archive v0.24.0", () => {
  it("只列自己归档 (receiverUserId = self)", async () => {
    mockState.archives.set("a-1", { id: "a-1", receiverUserId: OWNER.id, type: "CONTRACT_EXPIRING", title: "t1", content: "c1", link: null, entityKey: null, createdAt: new Date(), archivedAt: new Date() });
    mockState.archives.set("a-2", { id: "a-2", receiverUserId: OTHER.id, type: "PAYMENT_RECEIVED", title: "t2", content: "c2", link: null, entityKey: null, createdAt: new Date(), archivedAt: new Date() });
    const res = await archiveGET(new Request("http://localhost/api/messages/archive", { method: "GET" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toBe(0);
    expect(body.data.list.map((r: { id: string }) => r.id)).toEqual(["a-1"]);
  });
});

describe("POST /api/messages/batch v0.24.0 restore/purge", () => {
  it("action: restore → 批量还原", async () => {
    seedMessage("m-1", OWNER.id, { deletedAt: new Date() });
    seedMessage("m-2", OWNER.id, { deletedAt: new Date() });
    const req = new Request("http://localhost/api/messages/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m-1", "m-2"], action: "restore" })
    });
    const res = await batchPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.affected).toBe(2);
    expect(mockState.messages.get("m-1")!.deletedAt).toBeNull();
    expect(mockState.messages.get("m-2")!.deletedAt).toBeNull();
    expect(mockState.audits.map((a) => a.action)).toContain("MESSAGE_BATCH_RESTORE");
  });

  it("action: purge → 批量硬删", async () => {
    seedMessage("m-1", OWNER.id, { deletedAt: new Date() });
    seedMessage("m-2", OWNER.id, { deletedAt: new Date() });
    const req = new Request("http://localhost/api/messages/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m-1", "m-2"], action: "purge" })
    });
    const res = await batchPOST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.affected).toBe(2);
    expect(mockState.messages.has("m-1")).toBe(false);
    expect(mockState.messages.has("m-2")).toBe(false);
    expect(mockState.audits.map((a) => a.action)).toContain("MESSAGE_BATCH_PURGE");
  });

  it("action 非法 → 400 zod 校验", async () => {
    const req = new Request("http://localhost/api/messages/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["m-1"], action: "garbage" })
    });
    const res = await batchPOST(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/messages/archive/[id]/restore v0.24.0 用户恢复归档", () => {
  it("自己的归档 → 新建 inbox 行 + 删归档行", async () => {
    mockState.archives.set("a-1", { id: "a-1", receiverUserId: OWNER.id, type: "CONTRACT_EXPIRING", title: "t1", content: "c1", link: null, entityKey: null, createdAt: new Date(), archivedAt: new Date() });
    const res = await archiveRestorePOST(new Request("http://localhost/api/messages/archive/a-1/restore", { method: "POST" }), {
      params: Promise.resolve({ id: "a-1" })
    });
    expect(res.status).toBe(200);
    expect(mockState.archives.has("a-1")).toBe(false);
    // 新建的 inbox 行 readAt = null (视为新送达)
    const newRow = Array.from(mockState.messages.values()).find((m) => m.title === "t1");
    expect(newRow).toBeDefined();
    expect(newRow!.readAt).toBeNull();
    expect(newRow!.deletedAt).toBeNull();
  });

  it("别人的归档 → 403", async () => {
    mockState.archives.set("a-1", { id: "a-1", receiverUserId: OTHER.id, type: "CONTRACT_EXPIRING", title: "t1", content: "c1", link: null, entityKey: null, createdAt: new Date(), archivedAt: new Date() });
    const res = await archiveRestorePOST(new Request("http://localhost/api/messages/archive/a-1/restore", { method: "POST" }), {
      params: Promise.resolve({ id: "a-1" })
    });
    expect(res.status).toBe(403);
  });
});

const _sanity = ApiError;
const _sanityErr = ERROR_CODES.NOT_FOUND;
void _sanity;
void _sanityErr;
