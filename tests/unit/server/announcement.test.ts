// Announcement service 单元测试
//
// 覆盖:
//   - listAnnouncements 角色过滤、生效期过滤、软删过滤、keyword 搜索
//   - getAnnouncement 按 id + 可见性过滤（SALES 不可读 admin-only 公告）
//   - createAnnouncement / updateAnnouncement / softDeleteAnnouncement 权限与审计
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SessionUser } from "@/lib/session";
import type { Announcement } from "@prisma/client";

const now = new Date();
const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
const lastWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

const mockState = vi.hoisted(() => ({
  announcements: [] as Announcement[],
  audits: [] as Array<Record<string, unknown>>
}));

function matchesWhere(a: Announcement, where?: Record<string, unknown>): boolean {
  if (!where) return true;
  if (a.deletedAt !== null) return false;
  const ands = (where.AND as Array<Record<string, unknown>>) ?? [];
  for (const cond of ands) {
    // visibilityWhere 被包装成 { deletedAt: null, AND: [...] }
    if (cond.AND && Array.isArray(cond.AND)) {
      for (const inner of cond.AND as Array<Record<string, unknown>>) {
        if (inner.OR && Array.isArray(inner.OR)) {
          const or = inner.OR as Array<Record<string, unknown>>;
          // 角色过滤
          const roleBranch = or.find((o) => (o.targetRoles as Record<string, unknown>)?.has);
          if (roleBranch) {
            const role = ((roleBranch.targetRoles as Record<string, unknown>).has as string);
            if (a.targetRoles.length > 0 && !a.targetRoles.includes(role)) return false;
          }
          // 生效期起止过滤
          const toBranch = or.find((o) => (o.effectiveTo as Record<string, unknown>)?.gte);
          if (toBranch && a.effectiveTo && a.effectiveTo.getTime() < now.getTime()) return false;
          const fromBranch = or.find((o) => (o.effectiveFrom as Record<string, unknown>)?.lte);
          if (fromBranch && a.effectiveFrom && a.effectiveFrom.getTime() > now.getTime()) return false;
        }
      }
    }
    // keyword 过滤
    if (cond.OR && Array.isArray(cond.OR)) {
      const or = cond.OR as Array<Record<string, unknown>>;
      const kw =
        ((or[0]?.title as Record<string, unknown>)?.contains as string) ??
        ((or[0]?.content as Record<string, unknown>)?.contains as string);
      if (kw && !a.title.includes(kw) && !a.content.includes(kw)) return false;
    }
    // id 过滤（getAnnouncement）
    if (cond.id) {
      if (a.id !== cond.id) return false;
    }
  }
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    announcement: {
      findMany: vi.fn(async (args: { where?: Record<string, unknown>; orderBy?: unknown; skip?: number; take?: number }) => {
        let list = mockState.announcements.filter((a) => matchesWhere(a, args.where));
        if (args.skip) list = list.slice(args.skip);
        if (args.take) list = list.slice(0, args.take);
        return list.map((a) => ({ ...a }));
      }),
      count: vi.fn(async (args: { where?: Record<string, unknown> }) => {
        return mockState.announcements.filter((a) => matchesWhere(a, args.where)).length;
      }),
      findFirst: vi.fn(async (args: { where?: Record<string, unknown> }) => {
        const list = mockState.announcements.filter((a) => matchesWhere(a, args.where));
        return list[0] ? { ...list[0] } : null;
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const a = {
          id: `a-${mockState.announcements.length + 1}`,
          ...args.data,
          publishAt: (args.data.publishAt as Date) ?? now,
          createdAt: now,
          updatedAt: now,
          deletedAt: null
        } as Announcement;
        mockState.announcements.push(a);
        return { ...a };
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = mockState.announcements.findIndex((a) => a.id === args.where.id);
        if (idx === -1) throw new Error("not found");
        const a = mockState.announcements[idx]!;
        for (const [k, v] of Object.entries(args.data)) {
          if (k === "effectiveFrom" || k === "effectiveTo") {
            (a as Record<string, unknown>)[k] = v === undefined ? (a as Record<string, unknown>)[k] : v;
          } else {
            (a as Record<string, unknown>)[k] = v;
          }
        }
        a.updatedAt = now;
        return { ...a };
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
  listAnnouncements,
  getAnnouncement,
  createAnnouncement,
  updateAnnouncement,
  softDeleteAnnouncement
} from "@/server/services/announcement";

const makeUser = (roleCode: SessionUser["roleCode"], id = "u-1"): SessionUser => ({
  id,
  employeeNo: id,
  name: "Test",
  email: "test@qt.com",
  roleCode,
  permissions: []
});

function mkAnnouncement(overrides: Partial<Announcement>): Announcement {
  return {
    id: "a-x",
    title: "t",
    content: "c",
    publishUserId: "u-admin",
    publishAt: now,
    effectiveFrom: null,
    effectiveTo: null,
    pinned: false,
    targetRoles: [],
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides
  } as Announcement;
}

beforeEach(() => {
  mockState.announcements = [];
  mockState.audits = [];
});

describe("listAnnouncements", () => {
  it("按角色过滤：SALES 看不到 ADMIN-only 公告", async () => {
    mockState.announcements = [
      mkAnnouncement({ id: "a-1", title: "全员" }),
      mkAnnouncement({ id: "a-2", title: "Admin only", targetRoles: ["ADMIN"] })
    ];
    const r = await listAnnouncements(makeUser("SALES"), { page: 1, pageSize: 10 });
    expect(r.list.map((a) => a.id)).toEqual(["a-1"]);
  });

  it("按生效期过滤：过期公告不可见", async () => {
    mockState.announcements = [
      mkAnnouncement({ id: "a-1", title: "当前", effectiveFrom: yesterday, effectiveTo: tomorrow }),
      mkAnnouncement({ id: "a-2", title: "已过期", effectiveFrom: lastWeek, effectiveTo: yesterday })
    ];
    const r = await listAnnouncements(makeUser("SALES"), { page: 1, pageSize: 10 });
    expect(r.list.map((a) => a.id)).toEqual(["a-1"]);
  });

  it("keyword 搜索标题与正文", async () => {
    mockState.announcements = [
      mkAnnouncement({ id: "a-1", title: "春节放假" }),
      mkAnnouncement({ id: "a-2", title: "其他", content: "关于春节的通知" }),
      mkAnnouncement({ id: "a-3", title: "unrelated" })
    ];
    const r = await listAnnouncements(makeUser("SALES"), { page: 1, pageSize: 10, keyword: "春节" });
    expect(r.list).toHaveLength(2);
  });
});

describe("getAnnouncement", () => {
  it("SALES 直接 GET ADMIN-only id 应 404", async () => {
    mockState.announcements = [
      mkAnnouncement({ id: "a-1", title: "Admin only", targetRoles: ["ADMIN"] })
    ];
    await expect(getAnnouncement(makeUser("SALES"), "a-1")).rejects.toMatchObject({ status: 404 });
  });

  it("SALES 可读取目标包含 SALES 的公告", async () => {
    mockState.announcements = [
      mkAnnouncement({ id: "a-1", title: "SALES", targetRoles: ["SALES"] })
    ];
    const a = await getAnnouncement(makeUser("SALES"), "a-1");
    expect(a.id).toBe("a-1");
  });
});

describe("createAnnouncement", () => {
  it("OPS 可发布公告并记录审计", async () => {
    const a = await createAnnouncement(makeUser("OPS"), {
      title: "公告",
      content: "内容",
      pinned: true,
      targetRoles: ["SALES"]
    });
    expect(a.title).toBe("公告");
    expect(a.pinned).toBe(true);
    expect(mockState.audits[0]).toMatchObject({ action: "ANNOUNCEMENT_CREATE", entity: "Announcement" });
  });

  it("SALES 无权发布公告", async () => {
    await expect(createAnnouncement(makeUser("SALES"), { title: "x", content: "y" })).rejects.toMatchObject({ status: 403 });
  });
});

describe("updateAnnouncement", () => {
  it("可清空生效期", async () => {
    mockState.announcements = [
      mkAnnouncement({ id: "a-1", effectiveFrom: yesterday, effectiveTo: tomorrow })
    ];
    const updated = await updateAnnouncement(makeUser("OPS"), "a-1", {
      effectiveFrom: null,
      effectiveTo: null
    });
    expect(updated.effectiveFrom).toBeNull();
    expect(updated.effectiveTo).toBeNull();
  });
});

describe("softDeleteAnnouncement", () => {
  it("软删并记录审计", async () => {
    mockState.announcements = [mkAnnouncement({ id: "a-1" })];
    await softDeleteAnnouncement(makeUser("OPS"), "a-1");
    expect(mockState.announcements[0]!.deletedAt).not.toBeNull();
    expect(mockState.audits[0]).toMatchObject({ action: "ANNOUNCEMENT_DELETE", entity: "Announcement" });
  });
});
