import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

let dbReachable = false;

describe("GET /api/auth/dingtalk/poll", () => {
  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbReachable = true;
    } catch {
      dbReachable = false;
    }
  });

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    process.env.DINGTALK_APP_KEY = "k";
    process.env.DINGTALK_APP_SECRET = "s";
  });

  it("state missing -> 404 DINGTALK_STATE_NOT_FOUND", async () => {
    if (!dbReachable) return; // skip when no PG
    const { GET } = await import("@/app/api/auth/dingtalk/poll/route");
    const res = await GET(new Request("http://x/api/auth/dingtalk/poll?state=does-not-exist"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.errorCode).toBe("DINGTALK_STATE_NOT_FOUND");
  });
});