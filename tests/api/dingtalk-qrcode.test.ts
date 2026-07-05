import { describe, it, expect, vi, beforeEach } from "vitest";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("GET /api/auth/dingtalk/qrcode", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    process.env.DINGTALK_APP_KEY = "k";
    process.env.DINGTALK_APP_SECRET = "s";
    process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://x:x@localhost:5432/x";
  });

  it("env missing -> 503 DINGTALK_NOT_CONFIGURED", async () => {
    delete process.env.DINGTALK_APP_KEY;
    const { GET } = await import("@/app/api/auth/dingtalk/qrcode/route");
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.errorCode).toBe("DINGTALK_NOT_CONFIGURED");
  });

  it("upstream failure -> 502 DINGTALK_UPSTREAM_ERROR", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
    const { GET } = await import("@/app/api/auth/dingtalk/qrcode/route");
    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.errorCode).toBe("DINGTALK_UPSTREAM_ERROR");
  });
});