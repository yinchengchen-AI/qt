import { describe, it, expect, vi, beforeEach } from "vitest";

describe("GET /api/auth/dingtalk/enabled", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DINGTALK_APP_KEY;
    delete process.env.DINGTALK_APP_SECRET;
  });

  it("env missing -> enabled=false", async () => {
    const { GET } = await import("@/app/api/auth/dingtalk/enabled/route");
    const res = await GET();
    const body = await res.json();
    expect(body.data.enabled).toBe(false);
  });

  it("env set -> enabled=true", async () => {
    process.env.DINGTALK_APP_KEY = "k";
    process.env.DINGTALK_APP_SECRET = "s";
    const { GET } = await import("@/app/api/auth/dingtalk/enabled/route");
    const res = await GET();
    const body = await res.json();
    expect(body.data.enabled).toBe(true);
  });
});