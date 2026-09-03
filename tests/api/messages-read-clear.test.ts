// 消息中心路由回归 lock test — v0.21.13 missing-route regression
//
// 背景:
//   v0.21.13 补齐 POST /api/messages/read/clear(前端与服务层早已存在,路由从未入库,
//   点击「清空已读」404 静默失败)。mark-all-read 当时已存在,一并锁定防同类回归。
//
// 本文件是 characterization / lock 测试:
//   - 静态 import 两个路由 (route 文件被删 = 编译失败)
//   - mock @/lib/session.requireSession: 有 actor → 返回; 无 actor → 抛 ApiError(UNAUTHORIZED, 401)
//   - mock @/server/services/message.clearReadMessages → { deleted: 3 }
//   - mock @/server/services/message.markAllRead → { updated: 5 }
//   - 不打 DB / prisma, 不改 route.ts / service.ts
//
// 任何把这两个路由删掉、或偷换 requireSession 跳过鉴权、改坏 service 契约
// 的提交,都会让本套测试变红。

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionUser } from "@/lib/session";

// hoisted state: per-test 注入的 actor; null = 未登录
const sessionHolder = vi.hoisted(() => ({ actor: null as SessionUser | null }));

vi.mock("@/lib/session", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/session")>();
  // ApiError + ERROR_CODES 必须在 factory 内部 await 进来:
  // vi.hoisted + vi.mock 工厂先于静态 import 解析,
  // 顶层静态 import 此时未完成初始化,直接使用会拿到 undefined。
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

// service mock: 两条覆盖路径都返回固定形状, 路由层透传到 response.data
vi.mock("@/server/services/message", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/services/message")>();
  return {
    ...mod,
    clearReadMessages: async () => ({ deleted: 3 }),
    markAllRead: async () => ({ updated: 5 })
  };
});

// 静态 import —— 这是 lock 的核心:
// route.ts 被删除 / 改名 / 改坏 export 都会让 import 解析失败, CI 直接红。
import { POST as clearReadPOST } from "@/app/api/messages/read/clear/route";
import { POST as markAllReadPOST } from "@/app/api/messages/mark-all-read/route";
import { ApiError } from "@/lib/api";
import { ERROR_CODES } from "@/types/errors";

const ACTOR: SessionUser = {
  id: "u1",
  employeeNo: "u1",
  name: "u1",
  email: "u1@t.local",
  roleCode: "SALES",
  permissions: []
};

function makeClearReq(): Request {
  return new Request("http://localhost/api/messages/read/clear", { method: "POST" });
}

function makeMarkAllReq(): Request {
  return new Request("http://localhost/api/messages/mark-all-read", { method: "POST" });
}

beforeEach(() => {
  sessionHolder.actor = ACTOR;
});

describe("POST /api/messages/read/clear (v0.21.13 lock)", () => {
  it("已登录 → 200 + { code: 0, data: { deleted: 3 } }", async () => {
    const res = await clearReadPOST(makeClearReq());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.code).toBe(0);
    expect(j.data).toEqual({ deleted: 3 });
  });

  it("未登录 → 401 + errorCode === UNAUTHORIZED", async () => {
    sessionHolder.actor = null;
    const res = await clearReadPOST(makeClearReq());
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.errorCode).toBe(ERROR_CODES.UNAUTHORIZED);
    // 防止有人把 UNAUTHORIZED 字符串误用成错误 message 而非 errorCode 字段
    expect(j.errorCode).toBe("UNAUTHORIZED");
  });
});

describe("POST /api/messages/mark-all-read (v0.21.13 lock)", () => {
  it("已登录 → 200 + { code: 0, data: { updated: 5 } }", async () => {
    const res = await markAllReadPOST(makeMarkAllReq());
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.code).toBe(0);
    expect(j.data).toEqual({ updated: 5 });
  });

  it("未登录 → 401 + errorCode === UNAUTHORIZED", async () => {
    sessionHolder.actor = null;
    const res = await markAllReadPOST(makeMarkAllReq());
    expect(res.status).toBe(401);
    const j = await res.json();
    expect(j.errorCode).toBe(ERROR_CODES.UNAUTHORIZED);
    expect(j.errorCode).toBe("UNAUTHORIZED");
  });
});

// 编译期 sanity: 确认 ApiError / ERROR_CODES 在被静态 import 时也是有效的运行时值
// (防止有人删 lib/api 或 types/errors 时本文件编译失败但未触发 vitest)
const _sanityApiError = ApiError;
const _sanityErrCode = ERROR_CODES.UNAUTHORIZED;
void _sanityApiError;
void _sanityErrCode;
