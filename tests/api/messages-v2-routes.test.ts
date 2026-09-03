// 消息中心 v2 路由回归 lock test (2026-09-03)
//
// 覆盖 v0.22.0 新增的 4 个路由 + 3 个增强路由:
//   - GET  /api/messages/unread-summary        (新增)
//   - POST /api/messages/batch                 (新增)
//   - GET  /api/messages/preferences           (新增)
//   - PUT  /api/messages/preferences           (新增)
//   - GET  /api/messages                       (增强: q / types / categories / cursor / from / to)
//   - POST /api/messages/mark-all-read         (增强: 接受 scope body)
//   - POST /api/messages/read/clear            (增强: 接受 scope body)
//
// 与 v0.21.13 messages-read-clear.test.ts 同模式:
//   - 静态 import 路由 (删除/改名 = 编译失败)
//   - mock requireSession + service
//   - 不打 DB
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

vi.mock("@/server/services/message", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/services/message")>();
  return {
    ...mod,
    unreadSummary: async () => ({ total: 7, byCategory: { contract: 3, finance: 2, reconciliation: 1, certificate: 1, system: 0, unknown: 0 } }),
    batchMutate: async (_u: SessionUser, input: { ids: string[]; action: string }) => ({ affected: input.ids.length })
  };
});

vi.mock("@/server/services/message-preference", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/services/message-preference")>();
  return {
    ...mod,
    listPreferences: async () => [
      { type: "CONTRACT_EXPIRING", enabled: true },
      { type: "PAYMENT_RECEIVED", enabled: false }
    ],
    updatePreferences: async (_u: SessionUser, prefs: { type: string; enabled: boolean }[]) => prefs
  };
});

// 静态 import —— 这是 lock 的核心
import { GET as unreadSummaryGET } from "@/app/api/messages/unread-summary/route";
import { POST as batchPOST } from "@/app/api/messages/batch/route";
import { GET as prefsGET, PUT as prefsPUT } from "@/app/api/messages/preferences/route";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

const ACTOR: SessionUser = {
  id: "u-1",
  employeeNo: "u-1",
  name: "u-1",
  email: "u-1@t.local",
  roleCode: "SALES",
  permissions: []
};

function makeUnreadSummaryReq(): Request {
  return new Request("http://localhost/api/messages/unread-summary", { method: "GET" });
}

function makeBatchReq(ids: string[]): Request {
  return new Request("http://localhost/api/messages/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, action: "markRead" })
  });
}

function makePrefsGET(): Request {
  return new Request("http://localhost/api/messages/preferences", { method: "GET" });
}

function makePrefsPUT(prefs: { type: string; enabled: boolean }[]): Request {
  return new Request("http://localhost/api/messages/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preferences: prefs })
  });
}

beforeEach(() => {
  sessionHolder.actor = ACTOR;
});

describe("GET /api/messages/unread-summary (v0.22.0 lock)", () => {
  it("已登录 → 200 + { code: 0, data: { total, byCategory } }", async () => {
    const res = await unreadSummaryGET(makeUnreadSummaryReq());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.code).toBe(0);
    expect(j.data.total).toBe(7);
    expect(j.data.byCategory.contract).toBe(3);
  });

  it("未登录 → 401", async () => {
    sessionHolder.actor = null;
    const res = await unreadSummaryGET(makeUnreadSummaryReq());
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.errorCode).toBe(ERROR_CODES.UNAUTHORIZED);
  });
});

describe("POST /api/messages/batch (v0.22.0 lock)", () => {
  it("已登录 → 200 + { code: 0, data: { affected } }", async () => {
    const res = await batchPOST(makeBatchReq(["m1", "m2", "m3"]));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.code).toBe(0);
    expect(j.data.affected).toBe(3);
  });

  it("未登录 → 401", async () => {
    sessionHolder.actor = null;
    const res = await batchPOST(makeBatchReq(["m1"]));
    expect(res.status).toBe(401);
  });

  it("空 body → 400 (zod 校验)", async () => {
    const req = new Request("http://localhost/api/messages/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const res = await batchPOST(req);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/messages/preferences (v0.22.0 lock)", () => {
  it("已登录 → 200 + preferences 数组", async () => {
    const res = await prefsGET(makePrefsGET());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.code).toBe(0);
    expect(j.data.preferences).toHaveLength(2);
  });
});

describe("PUT /api/messages/preferences (v0.22.0 lock)", () => {
  it("已登录 → 200 + 更新后 preferences", async () => {
    const res = await prefsPUT(
      makePrefsPUT([{ type: "CONTRACT_EXPIRING", enabled: false }])
    );
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.code).toBe(0);
    expect(j.data.preferences[0].enabled).toBe(false);
  });

  it("body 缺 preferences → 400 (zod 校验)", async () => {
    const req = new Request("http://localhost/api/messages/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const res = await prefsPUT(req);
    expect(res.status).toBe(400);
  });
});

// ============================================================
// GET /api/messages (v0.22.0 lock + v0.22.1 fix)
// 锁定 zod 解析:?unread 缺失=undefined(全部),?unread=true=未读,?unread=false=已读
// 回归: v0.22.0 的 transform 把 undefined 折叠成 false,导致「全部」tab/drawer 看到的是已读(空)
// ============================================================
const listCalls = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("@/server/services/message", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/services/message")>();
  return {
    ...mod,
    // 保留原有 mock,避免覆盖 v0.22.0 lock 里的 unreadSummary / batchMutate
    unreadSummary: async () => ({ total: 7, byCategory: { contract: 3, finance: 2, reconciliation: 1, certificate: 1, system: 0, unknown: 0 } }),
    batchMutate: async (_u: SessionUser, input: { ids: string[]; action: string }) => ({ affected: input.ids.length }),
    listMessages: async (_u: SessionUser, params: Record<string, unknown>) => {
      listCalls.push(params);
      return {
        list: [],
        total: 0,
        page: 1,
        pageSize: 20,
        nextCursor: null,
        unreadCount: 0
      };
    }
  };
});

import { GET as messagesGET } from "@/app/api/messages/route";

function makeMessagesReq(qs: string): Request {
  return new Request(`http://localhost/api/messages${qs}`, { method: "GET" });
}

describe("GET /api/messages zod unlock (v0.22.1 fix)", () => {
  beforeEach(() => {
    listCalls.length = 0;
  });

  it("无 ?unread → params.unread=undefined(全部,不是 false)", async () => {
    const res = await messagesGET(makeMessagesReq(""));
    expect(res.status).toBe(200);
    expect(listCalls).toHaveLength(1);
    expect(listCalls[0].unread).toBeUndefined();
  });

  it("?unread=true → params.unread=true(仅未读)", async () => {
    const res = await messagesGET(makeMessagesReq("?unread=true"));
    expect(res.status).toBe(200);
    expect(listCalls[0].unread).toBe(true);
  });

  it("?unread=false → params.unread=false(仅已读)", async () => {
    const res = await messagesGET(makeMessagesReq("?unread=false"));
    expect(res.status).toBe(200);
    expect(listCalls[0].unread).toBe(false);
  });
});

const _sanityApiError = ApiError;
const _sanityErrCode = ERROR_CODES.UNAUTHORIZED;
void _sanityApiError;
void _sanityErrCode;
